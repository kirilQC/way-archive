// Pulls the transcript (auto or manual captions) for a YouTube video.
//
// Primary path: YouTube's innertube player API with the ANDROID client.
// This works from residential IPs but YouTube blocks it from datacenter IPs
// (Vercel, AWS, ...) with LOGIN_REQUIRED, so in production it usually fails.
//
// Fallback path: youtube-transcript.io, a transcript API that handles the
// proxying for us. Requires YT_TRANSCRIPT_IO_TOKEN (Basic API token from the
// profile page). Rate limit: 5 requests / 10 seconds.
//
// Returns { text, segments } where segments = [{ start: seconds, text }].

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

const ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    hl: 'en',
  },
};

function clean(text) {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?39;/g, "'");
}

function parseJson3(raw) {
  const data = JSON.parse(raw);
  return (data.events || [])
    .filter((e) => e.segs)
    .map((e) => ({
      start: Math.round((e.tStartMs || 0) / 1000),
      text: clean(e.segs.map((s) => s.utf8).join('')),
    }))
    .filter((s) => s.text);
}

// <timedtext format="3"> XML: <p t="startMs" d="durMs">text (or <s> children)</p>
function parseTimedTextXml(raw) {
  return [...raw.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)]
    .map(([, t, inner]) => ({
      start: Math.round(Number(t) / 1000),
      text: clean(decodeEntities(inner.replace(/<[^>]+>/g, ' '))),
    }))
    .filter((s) => s.text);
}

async function fetchViaInnertube(videoId) {
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
    body: JSON.stringify({ context: ANDROID_CONTEXT, videoId }),
  });
  if (!playerRes.ok) throw new Error(`player API HTTP ${playerRes.status}`);
  const player = await playerRes.json();

  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error(`video not playable: ${status}`);

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('no caption tracks available');

  // Prefer manual English captions, fall back to auto-generated (asr), then anything.
  const track =
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith('en')) ||
    tracks[0];

  const capRes = await fetch(track.baseUrl, { headers: { 'User-Agent': ANDROID_UA } });
  if (!capRes.ok) throw new Error(`caption fetch HTTP ${capRes.status}`);
  const raw = (await capRes.text()).trim();
  if (!raw) throw new Error('caption endpoint returned empty body');

  return raw.startsWith('{') ? parseJson3(raw) : parseTimedTextXml(raw);
}

// youtube-transcript.io returns, per video, caption tracks whose entries carry
// text plus a start time. Field names vary slightly across versions, so accept
// start/offset/tStartMs and text/snippet defensively.
function segmentsFromApiTrack(entries) {
  return (entries || [])
    .map((e) => {
      const startRaw = e.start ?? e.offset ?? (e.tStartMs != null ? e.tStartMs / 1000 : null);
      const text = clean(decodeEntities(String(e.text ?? e.snippet ?? '')));
      if (startRaw == null || !text) return null;
      return { start: Math.round(Number(startRaw)), text };
    })
    .filter(Boolean);
}

async function fetchViaTranscriptIo(videoId) {
  const token = process.env.YT_TRANSCRIPT_IO_TOKEN;
  if (!token) throw new Error('YT_TRANSCRIPT_IO_TOKEN not set');

  const res = await fetch('https://www.youtube-transcript.io/api/transcripts', {
    method: 'POST',
    headers: { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [videoId] }),
  });
  if (!res.ok) throw new Error(`youtube-transcript.io HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

  const video = (Array.isArray(data) ? data : data?.transcripts || data?.results || [])
    .find((v) => v?.id === videoId) || (Array.isArray(data) ? data[0] : null);
  if (!video) throw new Error('youtube-transcript.io returned no result for video');

  const tracks = video.tracks || video.transcripts || [];
  const track =
    tracks.find((t) => /^en/i.test(t.languageCode || '') || /english/i.test(t.language || '')) ||
    tracks[0];
  const entries = track?.transcript || track?.segments || video.transcript;

  const segments = segmentsFromApiTrack(entries);
  if (!segments.length) throw new Error('youtube-transcript.io returned no usable segments');
  return segments;
}

export async function fetchTranscript(videoId) {
  let segments;
  try {
    segments = await fetchViaInnertube(videoId);
  } catch (err) {
    console.log(`innertube transcript failed for ${videoId} (${err.message}), trying youtube-transcript.io`);
    segments = await fetchViaTranscriptIo(videoId);
  }
  if (!segments.length) throw new Error('empty transcript');

  return {
    text: segments.map((s) => s.text).join(' '),
    segments,
  };
}

// Formats segments into a transcript string with [mm:ss] markers roughly every
// 30 seconds, so the AI can attach timestamps to highlights.
export function timestampedTranscript(segments) {
  const lines = [];
  let current = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= 30) {
      current = { start: seg.start, parts: [seg.text] };
      lines.push(current);
    } else {
      current.parts.push(seg.text);
    }
  }
  return lines.map((l) => `[${formatTime(l.start)}] ${l.parts.join(' ')}`).join('\n');
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
