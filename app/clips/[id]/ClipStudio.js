'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { renderClip, wordChunks, buildSrt } from '../render.js';

const TYPES = { hook: 'Hook', story: 'Story', quote: 'Quotable', scripture: 'Scripture', practical: 'Practical', gospel: 'Gospel' };
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const clockTenths = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const cleanTitle = (t) => (t || '').split('|')[0].replace(/\s+-\s+[A-Z][\w'.]+(?:\s+[A-Z][\w'.]+){0,2}\s*$/, '').trim();
const slug = (t) => cleanTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const CROP_W = 9 / 16 / (16 / 9); // share of a 16:9 frame's width that a 9:16 crop covers
const MIN_LEN = 10; // every clip is 10-60 seconds, no exceptions
const MAX_LEN = 60;

// ~6 second transcript lines to click on when building a clip
function lines(segments) {
  const out = [];
  let cur = null;
  for (const s of segments) {
    if (!cur || s.start - cur.start >= 6) {
      cur = { start: s.start, text: s.text };
      out.push(cur);
    } else cur.text += ' ' + s.text;
  }
  return out.map((l, i) => ({ ...l, end: out[i + 1]?.start ?? l.start + 6, text: l.text.replace(/\s+/g, ' ').trim() }));
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="clip-btn"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        })
      }
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export default function ClipStudio({ sermon, initialClips, initialClipId, downloadsEnabled }) {
  const segments = sermon.transcript_segments || [];
  const tLines = useMemo(() => lines(segments), [segments]);
  const [clips, setClips] = useState(initialClips);
  const first = initialClips.find((c) => c.id === initialClipId) || initialClips[0] || null;
  const [sel, setSel] = useState(first ? { ...first } : { id: null, start_seconds: 60, end_seconds: 85, hook: '', caption: '', clip_type: null });
  const [anchor, setAnchor] = useState(null); // first click when picking a range in the transcript
  const [tab, setTab] = useState(first ? 'clips' : 'transcript');
  const [find, setFind] = useState('');

  // The loaded video: an MP4 of one sermon range from Oxylabs. from/to are sermon seconds.
  const [source, setSource] = useState(null); // { file, url, from, to }
  const [loading, setLoading] = useState('');
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const stopAt = useRef(null);
  const fetched = useRef(new Map()); // clip range -> Promise<{ file, from }> downloaded via Oxylabs

  const [opts, setOpts] = useState({ landscape: true, vertical: true, fit: 'crop', cropX: 0.5, subtitles: true, quality: 1080 });
  const [picked, setPicked] = useState(() => new Set(first?.id ? [first.id] : []));
  const [jobs, setJobs] = useState([]);
  const running = jobs.some((j) => ['rendering', 'queued', 'fetching'].includes(j.status));

  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  // Stop local preview playback at the clip's end
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (stopAt.current != null && v.currentTime + (source?.from || 0) >= stopAt.current) {
        v.pause();
        stopAt.current = null;
      }
    };
    v.addEventListener('timeupdate', onTime);
    return () => v.removeEventListener('timeupdate', onTime);
  }, [source]);

  const dur = Math.max(0, sel.end_seconds - sel.start_seconds);
  const lenOk = dur >= MIN_LEN - 0.05 && dur <= MAX_LEN + 0.05;
  const selText = useMemo(
    () =>
      tLines
        .filter((l) => l.end > sel.start_seconds && l.start < sel.end_seconds)
        .map((l) => l.text)
        .join(' '),
    [tLines, sel.start_seconds, sel.end_seconds]
  );

  // The loaded MP4 plays when the clip sits inside it; otherwise the YouTube embed does
  const covers = (c) => Boolean(source) && c.start_seconds >= source.from && c.end_seconds <= source.to;
  const useLocal = covers(sel);

  const seek = (t, play = true, until = null) => {
    if (useLocal && videoRef.current) {
      const v = videoRef.current;
      v.currentTime = Math.max(0, t - source.from);
      stopAt.current = until;
      if (play) v.play();
      return;
    }
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    for (const [func, args] of [['seekTo', [t, true]], play ? ['playVideo', []] : ['pauseVideo', []]]) {
      win.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    }
    if (until != null) {
      clearTimeout(stopAt.current);
      stopAt.current = setTimeout(
        () => win.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*'),
        (until - t) * 1000
      );
    }
  };

  const choose = (c) => {
    setSel({ ...c });
    setAnchor(null);
    seek(c.start_seconds, false);
  };

  const clickLine = (l) => {
    if (anchor == null) {
      setAnchor(l.start);
      setSel((s) => ({ ...s, id: null, kind: 'custom', start_seconds: l.start, end_seconds: l.end, hook: '', caption: '', clip_type: null }));
      seek(l.start, false);
    } else {
      const first = tLines.find((x) => x.start === anchor) || l;
      const a = Math.min(first.start, l.start);
      const b = Math.max(first.end, l.end);
      setSel((s) => ({ ...s, start_seconds: a, end_seconds: Math.min(Math.max(b, a + MIN_LEN), a + MAX_LEN) }));
      setAnchor(null);
    }
  };

  const nudge = (edge, d) =>
    setSel((s) => {
      // Adjusting an existing clip makes a new, unsaved custom clip
      const next = { ...s, id: null, kind: 'custom', [edge]: Math.max(0, Math.round((s[edge] + d) * 10) / 10) };
      const len = next.end_seconds - next.start_seconds;
      if (len < MIN_LEN || len > MAX_LEN) return s;
      return next;
    });

  const setEdgeToNow = (edge) => {
    const t = useLocal && videoRef.current ? videoRef.current.currentTime + source.from : null;
    if (t == null) return;
    setSel((s) => {
      const next = { ...s, id: null, kind: 'custom', [edge]: Math.round(t * 10) / 10 };
      const len = next.end_seconds - next.start_seconds;
      return len < MIN_LEN || len > MAX_LEN ? s : next;
    });
  };

  // One click: Oxylabs fetches this clip's range (with room to adjust) and it plays right here
  const loadVideo = async () => {
    setLoading('Requesting video…');
    setMsg('');
    try {
      const got = await fetchRange(sel, (note) => setLoading(note));
      if (source?.url) URL.revokeObjectURL(source.url);
      setSource({ ...got, url: URL.createObjectURL(got.file) });
    } catch (e) {
      setMsg(e.message);
    }
    setLoading('');
  };

  const api = async (method, body, query = '') => {
    const res = await fetch(`/api/clips${query}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed');
    return res.status === 204 ? null : res.json();
  };

  const suggest = async () => {
    setBusy('suggest');
    try {
      const out = await api('PATCH', { sermon_id: sermon.id, start_seconds: sel.start_seconds, end_seconds: sel.end_seconds });
      setSel((s) => ({ ...s, hook: out.hook, caption: out.caption }));
    } catch (e) {
      setMsg(e.message);
    }
    setBusy('');
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = await api('POST', { sermon_id: sermon.id, ...sel });
      setClips((cs) => [...cs, saved]);
      setSel({ ...saved });
      setPicked((p) => new Set([...p, saved.id]));
      setMsg('Saved to this sermon’s clips');
    } catch (e) {
      setMsg(e.message);
    }
    setBusy('');
  };

  const remove = async (c) => {
    if (!confirm('Delete this custom clip?')) return;
    try {
      await api('DELETE', null, `?id=${c.id}`);
      setClips((cs) => cs.filter((x) => x.id !== c.id));
    } catch (e) {
      setMsg(e.message);
    }
  };

  // Downloads a clip's range via Oxylabs (server) into our bucket, then into the browser
  const fetchRange = (c, onStatus) => {
    const key = `${c.start_seconds}-${c.end_seconds}`;
    if (!fetched.current.has(key)) {
      const p = (async () => {
        const res = await fetch('/api/clips/source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sermon_id: sermon.id, start_seconds: c.start_seconds, end_seconds: c.end_seconds }),
        });
        let st = await res.json();
        if (!res.ok) throw new Error(st.error || 'Could not start the download');
        const started = Date.now();
        while (st.status === 'pending') {
          if (Date.now() - started > 12 * 60 * 1000) throw new Error('Download timed out, try again');
          onStatus?.('Downloading from YouTube…');
          await new Promise((r) => setTimeout(r, 4000));
          const r = await fetch(`/api/clips/source?job=${encodeURIComponent(st.job)}&folder=${encodeURIComponent(st.folder)}`);
          st = { ...st, ...(await r.json()) };
        }
        if (st.status !== 'done') throw new Error(st.error || 'Download failed');
        onStatus?.('Receiving video…');
        const blob = await (await fetch(st.url)).blob();
        return { file: new File([blob], `${sermon.youtube_id}-${st.from}-${st.to}.mp4`, { type: 'video/mp4' }), from: st.from, to: st.to };
      })();
      fetched.current.set(key, p);
      p.catch(() => fetched.current.delete(key));
    }
    return fetched.current.get(key);
  };

  // Export: every picked clip (or the current selection) x every chosen format, one at a time
  const exportClips = async () => {
    if (!downloadsEnabled) return;
    const list = exportTargets;
    const formats = [opts.landscape && 'landscape', opts.vertical && 'vertical'].filter(Boolean);
    const queue = list.flatMap((c) =>
      formats.map((f) => ({
        key: `${c.id || 'sel'}-${c.start_seconds}-${f}-${Date.now()}`,
        clip: c,
        format: f,
        status: 'queued',
        progress: 0,
        filename: `way-${slug(sermon.title)}-${clock(c.start_seconds).replace(':', 'm')}s-${f === 'vertical' ? '9x16' : '16x9'}${opts.subtitles ? '-subs' : ''}.mp4`,
      }))
    );
    const update = (key, patch) => setJobs((js) => js.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    setJobs((j) => [...queue, ...j]);
    for (const job of queue) {
      try {
        // Reuse the loaded video when it covers this clip; otherwise fetch the clip's own range
        let input = covers(job.clip) ? source : null;
        if (!input) {
          update(job.key, { status: 'fetching', note: 'Requesting video…' });
          input = await fetchRange(job.clip, (note) => update(job.key, { status: 'fetching', note }));
        }
        update(job.key, { status: 'rendering', note: null });
        const blob = await renderClip(input.file, {
          start: job.clip.start_seconds,
          end: job.clip.end_seconds,
          sourceOffset: input.from,
          vertical: job.format === 'vertical',
          fit: opts.fit,
          cropX: opts.cropX,
          quality: opts.quality,
          segments: opts.subtitles ? segments : null,
          onProgress: (p) => update(job.key, { progress: p }),
        });
        update(job.key, { status: 'done', progress: 1, url: URL.createObjectURL(blob), size: blob.size });
      } catch (e) {
        update(job.key, { status: 'error', error: String(e.message || e) });
      }
    }
  };

  // Ticked clips, plus the clip in the editor when it is new or adjusted (not yet in the list)
  const exportTargets = [...clips.filter((c) => picked.has(c.id)), ...(sel.id == null ? [sel] : [])];
  const nFormats = [opts.landscape, opts.vertical].filter(Boolean).length;

  const srtFor = (c) => buildSrt(wordChunks(segments, c.start_seconds, c.end_seconds));

  const findRe = find.trim().length > 1 ? new RegExp(find.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const auto = clips.filter((c) => c.kind === 'auto');
  const custom = clips.filter((c) => c.kind === 'custom');

  return (
    <main className="studio">
      <div className="studio-head">
        <Link href="/clips" className="back">
          ← All clips
        </Link>
        <h1>{cleanTitle(sermon.title)}</h1>
        <div className="studio-sub">
          {sermon.speaker} · {new Date(sermon.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          {' · '}
          <Link href={`/sermon/${sermon.id}`} className="meta-link">
            Sermon page
          </Link>
        </div>
      </div>

      <div className="studio-grid">
        <div className="studio-left">
          <div className="studio-player">
            {useLocal ? (
              <div className="studio-frame">
                <video ref={videoRef} src={source.url} controls playsInline />
                {opts.vertical && opts.fit === 'crop' && (
                  <div className="crop-guide" style={{ left: `${opts.cropX * (1 - CROP_W) * 100}%`, width: `${CROP_W * 100}%` }} />
                )}
              </div>
            ) : (
              <div className="video-wrap">
                <iframe
                  ref={iframeRef}
                  src={`https://www.youtube.com/embed/${sermon.youtube_id}?enablejsapi=1&start=${Math.floor(sel.start_seconds)}`}
                  title={sermon.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            )}
          </div>

          <div className={`source-bar${useLocal ? ' loaded' : ''}`}>
            {useLocal ? (
              <span>
                <b>Video loaded</b> {clock(source.from)} to {clock(source.to)} · adjust within this range, or load again after moving the clip
              </span>
            ) : (
              <span>
                <b>{source ? 'Clip moved outside the loaded video' : 'Preview is the YouTube player'}</b>
                {downloadsEnabled ? ' · load the MP4 for a frame-accurate preview and crop guide' : ' · video downloads are not configured yet'}
              </span>
            )}
            {downloadsEnabled && !useLocal && (
              <button className="clip-btn primary" onClick={loadVideo} disabled={!!loading || !lenOk}>
                {loading || 'Load video'}
              </button>
            )}
          </div>

          <div className="editor">
            <div className="editor-range">
              <div className="edge">
                <span>Start</span>
                <button onClick={() => nudge('start_seconds', -0.5)}>−</button>
                <b>{clockTenths(sel.start_seconds)}</b>
                <button onClick={() => nudge('start_seconds', 0.5)}>+</button>
                {useLocal && (
                  <button className="now" onClick={() => setEdgeToNow('start_seconds')} title="Set to the video's current time">
                    now
                  </button>
                )}
              </div>
              <div className="edge">
                <span>End</span>
                <button onClick={() => nudge('end_seconds', -0.5)}>−</button>
                <b>{clockTenths(sel.end_seconds)}</b>
                <button onClick={() => nudge('end_seconds', 0.5)}>+</button>
                {useLocal && (
                  <button className="now" onClick={() => setEdgeToNow('end_seconds')} title="Set to the video's current time">
                    now
                  </button>
                )}
              </div>
              <div className="edge len">
                <span>Length</span>
                <b className={lenOk ? '' : 'warn'} title="Clips are 10 to 60 seconds">{Math.round(dur)}s</b>
              </div>
              <button className="clip-btn primary" onClick={() => seek(sel.start_seconds, true, sel.end_seconds)}>
                ▶ Preview
              </button>
            </div>
            <input className="editor-hook" placeholder="Hook (on-screen text)" value={sel.hook || ''} onChange={(e) => setSel((s) => ({ ...s, hook: e.target.value }))} />
            <textarea className="editor-caption" placeholder="Caption" rows={2} value={sel.caption || ''} onChange={(e) => setSel((s) => ({ ...s, caption: e.target.value }))} />
            <p className="editor-text">{selText}</p>
            <div className="clip-actions">
              <Copy text={selText} label="Copy transcript" />
              <Copy text={[sel.hook, sel.caption].filter(Boolean).join('\n\n')} label="Copy hook + caption" />
              <button className="clip-btn" onClick={() => downloadBlob(new Blob([srtFor(sel)], { type: 'text/plain' }), `way-${slug(sermon.title)}-${clock(sel.start_seconds).replace(':', 'm')}s.srt`)}>
                SRT
              </button>
              <a className="clip-btn" href={`https://youtu.be/${sermon.youtube_id}?t=${Math.floor(sel.start_seconds)}`} target="_blank" rel="noreferrer">
                YouTube ↗
              </a>
              <button className="clip-btn" onClick={suggest} disabled={!!busy}>
                {busy === 'suggest' ? 'Writing…' : 'Suggest hook + caption'}
              </button>
              {!sel.id && (
                <button className="clip-btn primary" onClick={save} disabled={!!busy || !lenOk}>
                  {busy === 'save' ? 'Saving…' : 'Save clip'}
                </button>
              )}
            </div>
            {msg && <div className="studio-msg">{msg}</div>}
          </div>

          <div className="export">
            <h3>Export MP4</h3>
            <div className="export-opts">
              <label>
                <input type="checkbox" checked={opts.landscape} onChange={(e) => setOpts((o) => ({ ...o, landscape: e.target.checked }))} /> Landscape 16:9
              </label>
              <label>
                <input type="checkbox" checked={opts.vertical} onChange={(e) => setOpts((o) => ({ ...o, vertical: e.target.checked }))} /> Vertical 9:16
              </label>
              <label>
                <input type="checkbox" checked={opts.subtitles} onChange={(e) => setOpts((o) => ({ ...o, subtitles: e.target.checked }))} /> Subtitles
              </label>
              <select value={opts.quality} onChange={(e) => setOpts((o) => ({ ...o, quality: Number(e.target.value) }))}>
                <option value={1080}>1080p</option>
                <option value={720}>720p (faster)</option>
              </select>
            </div>
            {opts.vertical && (
              <div className="export-opts">
                <label>
                  <input type="radio" checked={opts.fit === 'crop'} onChange={() => setOpts((o) => ({ ...o, fit: 'crop' }))} /> Crop to fill
                </label>
                <label>
                  <input type="radio" checked={opts.fit === 'blur'} onChange={() => setOpts((o) => ({ ...o, fit: 'blur' }))} /> Whole frame, blurred background
                </label>
                {opts.fit === 'crop' && (
                  <label className="crop-x">
                    Crop position
                    <input type="range" min={0} max={1} step={0.01} value={opts.cropX} onChange={(e) => setOpts((o) => ({ ...o, cropX: Number(e.target.value) }))} />
                  </label>
                )}
              </div>
            )}
            <button className="clip-btn primary export-go" onClick={exportClips} disabled={!downloadsEnabled || running || !nFormats || !exportTargets.length || exportTargets.some((c) => c.end_seconds - c.start_seconds > MAX_LEN + 0.05 || c.end_seconds - c.start_seconds < MIN_LEN - 0.05)}>
              {running
                ? 'Rendering…'
                : `Export ${exportTargets.length} clip${exportTargets.length === 1 ? '' : 's'} × ${nFormats} format${nFormats === 1 ? '' : 's'}`}
            </button>
            {!downloadsEnabled && <div className="export-hint">MP4 export turns on once the Oxylabs credentials are set.</div>}
            {jobs.length > 0 && (
              <div className="jobs">
                {jobs.map((j) => (
                  <div key={j.key} className={`job ${j.status}`}>
                    <span className="job-name">
                      {j.format === 'vertical' ? '9:16' : '16:9'} · {clock(j.clip.start_seconds)} · {j.clip.hook || 'Custom clip'}
                    </span>
                    {j.status === 'done' ? (
                      <a className="clip-btn primary" href={j.url} download={j.filename}>
                        Download · {(j.size / 1e6).toFixed(0)} MB
                      </a>
                    ) : j.status === 'error' ? (
                      <span className="job-err">{j.error}</span>
                    ) : j.status === 'fetching' ? (
                      <span className="job-note">{j.note}</span>
                    ) : (
                      <span className="job-bar">
                        <i style={{ width: `${Math.round(j.progress * 100)}%` }} />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="studio-right">
          <div className="studio-tabs">
            <button className={tab === 'clips' ? 'on' : ''} onClick={() => setTab('clips')}>
              Clips <i>{clips.length}</i>
            </button>
            <button className={tab === 'transcript' ? 'on' : ''} onClick={() => setTab('transcript')}>
              Build from transcript
            </button>
          </div>

          {tab === 'clips' ? (
            <div className="clist">
              {[['Auto clips', auto], ['Custom clips', custom]].map(([label, list]) =>
                list.length ? (
                  <div key={label}>
                    <h4>{label}</h4>
                    {list.map((c) => (
                      <div key={c.id} className={`citem${sel.id === c.id ? ' on' : ''}`} onClick={() => choose(c)}>
                        <input
                          type="checkbox"
                          checked={picked.has(c.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setPicked((p) => {
                              const n = new Set(p);
                              e.target.checked ? n.add(c.id) : n.delete(c.id);
                              return n;
                            })
                          }
                          title="Include in export"
                        />
                        <span className="citem-body">
                          <span className="citem-meta">
                            {c.clip_type && <i className={`ctype t-${c.clip_type}`}>{TYPES[c.clip_type]}</i>}
                            {clock(c.start_seconds)} · {Math.round(c.end_seconds - c.start_seconds)}s
                            {c.created_by ? ` · ${c.created_by}` : ''}
                          </span>
                          <b>{c.hook || 'Untitled clip'}</b>
                        </span>
                        {c.kind === 'custom' && (
                          <button
                            className="citem-del"
                            onClick={(e) => {
                              e.stopPropagation();
                              remove(c);
                            }}
                            title="Delete"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null
              )}
              {!clips.length && <p className="empty-small">No clips yet. Build one from the transcript.</p>}
            </div>
          ) : (
            <div className="tlines-wrap">
              <input className="tfind" placeholder="Search this transcript" value={find} onChange={(e) => setFind(e.target.value)} />
              <div className="tlines-hint">{anchor == null ? 'Click a line to start a clip, then click where it should end.' : 'Now click the line where the clip ends.'}</div>
              <div className="tlines">
                {tLines.map((l) => {
                  const inSel = l.end > sel.start_seconds && l.start < sel.end_seconds;
                  const hit = findRe && findRe.test(l.text);
                  if (findRe && !hit) return null;
                  return (
                    <button key={l.start} className={`tline${inSel ? ' in' : ''}${anchor === l.start ? ' anchor' : ''}`} onClick={() => clickLine(l)}>
                      <span className="hl-time">{clock(l.start)}</span>
                      <span>{l.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
