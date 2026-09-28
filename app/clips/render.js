// In-browser clip rendering with ffmpeg.wasm. The sermon video never leaves the user's
// machine: they pick the file they downloaded from YouTube Studio (or the raw export), it is
// mounted read-only (WORKERFS, so only the bytes around each clip are read, not the whole
// file), and each clip is trimmed, reframed, optionally subtitled, and encoded to MP4.
'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
const FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/anton/Anton-Regular.ttf';
const FONT_NAME = 'Anton';

let enginePromise = null;
let mountedName = null;

export function loadEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        // Our own copy of the worker, so the bundler can't rewrite its import() of the core
        classWorkerURL: new URL('/ffmpeg/worker.js', window.location.origin).href,
        coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      const font = new Uint8Array(await (await fetch(FONT_URL)).arrayBuffer());
      await ffmpeg.createDir('/fonts');
      await ffmpeg.writeFile(`/fonts/${FONT_NAME}.ttf`, font);
      await ffmpeg.createDir('/in');
      return ffmpeg;
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

async function mountSource(ffmpeg, file) {
  if (mountedName === file.name) return `/in/${file.name}`;
  if (mountedName) await ffmpeg.unmount('/in');
  await ffmpeg.mount('WORKERFS', { files: [file] }, '/in');
  mountedName = file.name;
  return `/in/${file.name}`;
}

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Caption segments -> short 2-4 word lines timed by word position (the Reels look)
export function wordChunks(segments, clipStart, clipEnd) {
  const segs = segments.filter((s) => s.start < clipEnd && s.start >= clipStart - 4);
  const words = [];
  segs.forEach((s, i) => {
    const next = segs[i + 1]?.start ?? Math.min(s.start + 4, clipEnd);
    const ws = s.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const step = Math.max(0.12, (next - s.start) / Math.max(1, ws.length));
    ws.forEach((w, j) => words.push({ t: s.start + j * step, w }));
  });
  const inClip = words.filter((x) => x.t >= clipStart - 0.05 && x.t < clipEnd);
  const chunks = [];
  let cur = null;
  for (const x of inClip) {
    if (!cur || cur.words.length >= 4 || (cur.words.join(' ') + ' ' + x.w).length > 20 || /[.?!]$/.test(cur.words.at(-1))) {
      cur = { start: x.t - clipStart, words: [] };
      chunks.push(cur);
    }
    cur.words.push(x.w);
  }
  return chunks.map((c, i) => ({
    start: Math.max(0, c.start),
    end: Math.min(chunks[i + 1]?.start ?? c.start + 1.2, clipEnd - clipStart),
    text: c.words.join(' '),
  }));
}

function buildAss(chunks, { width, height, vertical }) {
  const size = vertical ? Math.round(width * 0.11) : Math.round(height * 0.07);
  const marginV = vertical ? Math.round(height * 0.26) : Math.round(height * 0.07);
  const outline = Math.max(3, Math.round(size / 16));
  const esc = (t) => t.replace(/[{}\\]/g, '').toUpperCase();
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${FONT_NAME},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${outline},0,2,60,60,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...chunks.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,,0,0,0,,${esc(c.text)}`),
    '',
  ].join('\n');
}

// SRT for editors (clip-relative timing)
export function buildSrt(chunks) {
  const t = (s) => assTime(s).replace(/^(\d):/, '0$1:').replace('.', ',') + '0';
  return chunks.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.text}\n`).join('\n');
}

// opts: { start, end (sermon time), vertical, fit: 'crop'|'blur', cropX (0..1), quality: 1080|720,
//         segments (sermon captions) | null for no subtitles, onProgress(0..1),
//         sourceOffset: sermon time at the file's 0:00 (a downloaded clip range starts partway in) }
export async function renderClip(file, opts) {
  const ffmpeg = await loadEngine();
  const input = await mountSource(ffmpeg, file);
  const dur = Math.max(1, opts.end - opts.start);
  const q = opts.quality === 720 ? 720 : 1080;
  const [W, H] = opts.vertical ? [q, Math.round((q * 16) / 9)] : [Math.round((q * 16) / 9), q];

  let vf;
  if (!opts.vertical) vf = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  else if (opts.fit === 'blur') {
    vf = `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=18:2[bg];[b]scale=${W}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
  } else {
    const x = Math.min(1, Math.max(0, opts.cropX ?? 0.5)).toFixed(3);
    vf = `crop=trunc(ih*9/16/2)*2:ih:(iw-trunc(ih*9/16/2)*2)*${x}:0,scale=${W}:${H},setsar=1`;
  }

  const job = `job-${Date.now()}`;
  if (opts.segments?.length) {
    const chunks = wordChunks(opts.segments, opts.start, opts.end);
    await ffmpeg.writeFile(`/${job}.ass`, buildAss(chunks, { width: W, height: H, vertical: opts.vertical }));
    vf += `,subtitles=/${job}.ass:fontsdir=/fonts`;
  }

  const onProgress = ({ time }) => opts.onProgress?.(Math.min(1, time / 1e6 / dur));
  ffmpeg.on('progress', onProgress);
  try {
    const code = await ffmpeg.exec([
      '-ss', String(Math.max(0, opts.start - (opts.sourceOffset || 0))),
      '-t', String(dur),
      '-i', input,
      '-filter_complex', vf,
      // Bitrate capped at what Reels/Shorts/TikTok recommend, so files stay a sensible size
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-maxrate', q === 720 ? '5M' : '8M', '-bufsize', q === 720 ? '10M' : '16M',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      `/${job}.mp4`,
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(`/${job}.mp4`);
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', onProgress);
    await ffmpeg.deleteFile(`/${job}.mp4`).catch(() => {});
    await ffmpeg.deleteFile(`/${job}.ass`).catch(() => {});
  }
}
