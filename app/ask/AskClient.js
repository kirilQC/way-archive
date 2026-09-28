'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  'Find me 5 clips on anxiety for Reels',
  'Every time Romans 8:28 was preached',
  'Show me sermons about money',
  'Compare how Noah and Grant talk about fear',
  'Build a 4 week small group guide on prayer',
  'What does the Bible say about forgiveness?',
];

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

// "Title | Speaker" or "Title - Speaker": drop the speaker suffix, it is shown separately
const cleanTitle = (t) => (t || '').split('|')[0].replace(/\s+-\s+[A-Z][\w'.]+(?:\s+[A-Z][\w'.]+){0,2}\s*$/, '').trim();
const trimQuote = (q, n = 220) => (q && q.length > n ? q.slice(0, q.lastIndexOf(' ', n)) + '…' : q);

function VerseCard({ reference, delay = 0 }) {
  const [passage, setPassage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/passage?ref=${encodeURIComponent(reference)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && setPassage(data))
      .catch(() => !cancelled && setPassage({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [reference]);

  if (passage?.error) return null;
  return (
    <div className="ra-pull pop-in" style={{ animationDelay: `${delay}ms` }}>
      <b>{reference}</b>
      {passage?.text ? (
        <span>
          “{passage.text}
          {passage.truncated ? '…' : '”'} <i className="verse-trans">({passage.translation})</i>
        </span>
      ) : (
        <span>Loading…</span>
      )}
    </div>
  );
}

function SourceCard({ s, delay = 0 }) {
  if ((s.moments || []).length) {
    return (
      <div className="ask-source has-moments pop-in" style={{ animationDelay: `${delay}ms` }}>
        <Link href={`/sermon/${s.id}`} className="ask-source-head">
          {s.thumbnail && <img className="ask-source-thumb" src={s.thumbnail} alt="" loading="lazy" />}
          <span className="ask-source-body">
            <b>{cleanTitle(s.title)}</b>
            <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
          </span>
        </Link>
        <div className="ask-moments">
          {s.moments.map((m) => (
            <Link key={m.start_seconds} href={`/sermon/${s.id}?t=${m.start_seconds}`} className="ask-moment">
              <span className="ask-moment-t">{clock(m.start_seconds)}</span>
              <span>
                {m.note || 'Jump to this moment'}
                {m.quote && <q className="ask-moment-q">{trimQuote(m.quote)}</q>}
              </span>
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return (
    <Link href={`/sermon/${s.id}`} className="ask-source pop-in" style={{ animationDelay: `${delay}ms` }}>
      {s.thumbnail && <img className="ask-source-thumb" src={s.thumbnail} alt="" loading="lazy" />}
      <span className="ask-source-body">
        <b>{cleanTitle(s.title)}</b>
        <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
      </span>
    </Link>
  );
}

// Inline: **bold** and citation markers [n] / [1][3] / [1, 3]
function Inline({ text, cites }) {
  const out = [];
  const re = /\*\*(.+?)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<b key={k++}>{m[1]}</b>);
    else {
      for (const n of m[2].split(/\s*,\s*/).map(Number)) {
        const c = cites?.get(n);
        out.push(
          c ? (
            <Link
              key={k++}
              href={`/sermon/${c.sermon_id}?t=${c.start_seconds}`}
              className="cite"
              title={`${cleanTitle(c.title)} at ${clock(c.start_seconds)}`}
            >
              {n}
            </Link>
          ) : (
            <sup key={k++} className="cite pending">
              {n}
            </sup>
          )
        );
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Minimal structure for answers: "## " headings, "- " bullets, paragraphs
function RichText({ text, citations, streaming }) {
  const cites = new Map((citations || []).map((c) => [c.n, c]));
  const blocks = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#{2,3}\s/.test(line)) blocks.push({ type: 'h', text: line.replace(/^#+\s*/, '') });
    else if (/^[-•*]\s/.test(line)) {
      const item = line.replace(/^[-•*]\s+/, '');
      if (blocks.at(-1)?.type === 'ul') blocks.at(-1).items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
    } else blocks.push({ type: 'p', text: line });
  }
  return blocks.map((b, i) => {
    const cursor = streaming && i === blocks.length - 1 ? <span className="chat-cursor" /> : null;
    if (b.type === 'h')
      return (
        <h3 key={i} className="ra-h">
          <Inline text={b.text} cites={cites} />
        </h3>
      );
    if (b.type === 'ul')
      return (
        <ul key={i} className="ra-ul">
          {b.items.map((it, j) => (
            <li key={j}>
              <Inline text={it} cites={cites} />
              {j === b.items.length - 1 && cursor}
            </li>
          ))}
        </ul>
      );
    return (
      <p key={i}>
        <Inline text={b.text} cites={cites} />
        {cursor}
      </p>
    );
  });
}

function Citations({ citations }) {
  return (
    <div className="ra-srcs">
      <h4>Sources</h4>
      <ol className="cite-list">
        {citations.map((c, k) => (
          <li key={c.n} className="pop-in" style={{ animationDelay: `${k * 40}ms` }}>
            <Link href={`/sermon/${c.sermon_id}?t=${c.start_seconds}`} className="cite-item">
              <span className="cite-n">{c.n}</span>
              {c.thumbnail && <img src={c.thumbnail} alt="" loading="lazy" />}
              <span className="cite-body">
                <b>{cleanTitle(c.title)}</b>
                <span className="cite-meta">
                  {[c.speaker, formatDate(c.date), clock(c.start_seconds)].filter(Boolean).join(' · ')}
                </span>
                <q>{trimQuote(c.quote, 260)}</q>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportClips(clips, topic) {
  const origin = window.location.origin;
  const rows = [
    ['Sermon', 'Speaker', 'Date', 'Start', 'End', 'Seconds', 'YouTube', 'Archive', 'Hook', 'Caption', 'Transcript'],
    ...clips.map((c) => [
      cleanTitle(c.title),
      c.speaker,
      c.date,
      clock(c.start_seconds),
      clock(c.end_seconds),
      c.end_seconds - c.start_seconds,
      `https://youtu.be/${c.youtube_id}?t=${c.start_seconds}`,
      `${origin}/sermon/${c.sermon_id}?t=${c.start_seconds}`,
      c.hook,
      c.caption,
      c.transcript,
    ]),
  ];
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `way-clips-${(topic || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="clip-btn"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

function ClipCard({ c, delay }) {
  const len = c.end_seconds - c.start_seconds;
  return (
    <div className="clip-card pop-in" style={{ animationDelay: `${delay}ms` }}>
      <Link href={`/sermon/${c.sermon_id}?t=${c.start_seconds}`} className="clip-thumb">
        {c.thumbnail && <img src={c.thumbnail} alt="" loading="lazy" />}
        <span className="clip-time">
          {clock(c.start_seconds)} to {clock(c.end_seconds)} · {len}s
        </span>
      </Link>
      <div className="clip-body">
        <div className="clip-hook">{c.hook}</div>
        <div className="clip-src">
          {cleanTitle(c.title)} · {[c.speaker, formatDate(c.date)].filter(Boolean).join(' · ')}
        </div>
        {c.caption && <p className="clip-caption">{c.caption}</p>}
        <details className="clip-tx">
          <summary>Transcript</summary>
          <p>{c.transcript}</p>
        </details>
        <div className="clip-actions">
          <CopyButton text={c.transcript} label="Copy transcript" />
          <CopyButton text={[c.hook, c.caption].filter(Boolean).join('\n\n')} label="Copy hook + caption" />
          <a className="clip-btn" href={`https://youtu.be/${c.youtube_id}?t=${c.start_seconds}`} target="_blank" rel="noreferrer">
            YouTube ↗
          </a>
        </div>
      </div>
    </div>
  );
}

// Narrow the last request without retyping: chips for speakers and years present in results
function RefineChips({ items, onPick }) {
  const speakers = [...new Set(items.map((x) => x.speaker).filter(Boolean))];
  const years = [...new Set(items.map((x) => String(x.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const chips = [
    ...(speakers.length > 1 ? speakers.slice(0, 4).map((s) => ({ label: `Only ${s}`, q: `Same request, but only sermons by ${s}` })) : []),
    ...(years.length > 1 ? years.slice(0, 4).map((y) => ({ label: `Only ${y}`, q: `Same request, but only from ${y}` })) : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="refine">
      <span>Refine</span>
      {chips.map((c) => (
        <button key={c.label} onClick={() => onPick(c.q)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

// What the server sees of earlier assistant turns, so follow-ups ("the second one") resolve
function historyText(m) {
  if (m.role !== 'assistant') return m.content;
  if (m.mode === 'list') {
    return (
      `Listed sermons: ${
        (m.sources || [])
          .map((s, i) => `${i + 1}. ${s.title}${(s.moments || []).length ? ` (${s.moments.map((x) => `${clock(x.start_seconds)} ${x.note}`).join('; ')})` : ''}`)
          .join(' | ') || 'none found'
      }`
    );
  }
  if (m.mode === 'clips') {
    return `Listed clips: ${(m.clips || []).map((c, i) => `${i + 1}. ${c.title} ${clock(c.start_seconds)}-${clock(c.end_seconds)} "${c.hook}"`).join(' | ') || 'none found'}`;
  }
  return m.content;
}

export default function AskClient({ recent = [] }) {
  // messages: { role: 'user'|'assistant', content, mode?, verses?, sources?, citations?, clips? }
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  const sentInitial = useRef(false);
  const started = messages.length > 0 || loading;

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, loading]);

  const send = async (text) => {
    const q = (text || input).trim();
    if (q.length < 2 || loading) return;
    setInput('');
    setError(null);
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setLoading(true);

    // Typewriter: network chunks land in `target`; the ticker reveals it at a
    // steady rate so the answer prints smoothly instead of jumping per chunk.
    let target = '';
    let shown = 0;
    let tail = null;
    let streamEnded = false;

    const ticker = setInterval(() => {
      if (shown > target.length) shown = target.length;
      if (shown < target.length) {
        const gap = target.length - shown;
        // Hidden tabs throttle timers; skip the animation and show everything.
        shown = document.hidden
          ? target.length
          : shown + Math.min(gap, Math.max(2, Math.round(gap / 30)));
        setMessages([...next, { role: 'assistant', content: target.slice(0, shown), streaming: true }]);
      } else if (streamEnded) {
        clearInterval(ticker);
        setMessages([
          ...next,
          {
            role: 'assistant',
            content: target.trimEnd(),
            mode: tail?.mode,
            kind: tail?.kind,
            topic: tail?.topic,
            verses: tail?.verses || [],
            sources: tail?.sources || [],
            citations: tail?.citations || [],
            clips: tail?.clips || [],
          },
        ]);
        setLoading(false);
      }
    }, 16);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: historyText(m) })) }),
      });
      if (!res.ok || !res.body) throw new Error('failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const DONE = '###DONE###';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const idx = buffer.indexOf(DONE);
        if (idx !== -1) {
          target = buffer.slice(0, idx).trimEnd();
          // The JSON tail may still be arriving; read to the end before parsing
          let rest = buffer.slice(idx + DONE.length);
          while (true) {
            const more = await reader.read();
            if (more.done) break;
            rest += decoder.decode(more.value, { stream: true });
          }
          try {
            tail = JSON.parse(rest);
          } catch {}
          break;
        }
        target = buffer;
      }
      streamEnded = true;
    } catch {
      clearInterval(ticker);
      setError('Something went wrong. Try again.');
      setMessages(next);
      setInput(q);
      setLoading(false);
    }
  };

  // /ask?q=... runs that question on arrival (used by links elsewhere on the site)
  useEffect(() => {
    if (sentInitial.current) return;
    sentInitial.current = true;
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bar = (
    <div className="ac-bar">
      <input
        placeholder="Ask anything, find a sermon, or pull clips"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
      />
      <button onClick={() => send()} disabled={loading}>
        {loading ? 'Thinking…' : 'Ask'}
      </button>
    </div>
  );

  const lastIdx = messages.length - 1;

  return (
    <main className="ask-cinema">
      <div className={`ac-hero${started ? ' compact' : ''}`}>
        {recent.length > 0 && (
          <div className="ac-bgs">
            {recent.map((s) => (
              <div key={s.id} style={{ backgroundImage: `url(${s.thumbnail})` }} />
            ))}
          </div>
        )}
        <h1>
          Bring the question <em>you actually have.</em>
        </h1>
        {!started && (
          <>
            {bar}
            <div className="ac-chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            {recent.length > 0 && (
              <>
                <div className="ac-label">Latest from the pulpit</div>
                <div className="ac-strip">
                  {recent.map((s) => (
                    <SourceCard key={s.id} s={s} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {started && (
        <div className="ac-log">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ra-ask">
                <div className="ra-eyebrow">You asked</div>
                <h2 className="ra-q">{m.content}</h2>
              </div>
            ) : m.mode === 'clips' ? (
              <div key={i} className="ra-body">
                <div className="ra-srcs ra-list">
                  <div className="clips-head">
                    <h4>
                      {m.clips.length
                        ? `${m.clips.length} clip${m.clips.length === 1 ? '' : 's'} on ${m.topic}`
                        : `No clips found on ${m.topic}`}
                    </h4>
                    {m.clips.length > 0 && (
                      <button className="clip-btn" onClick={() => exportClips(m.clips, m.topic)}>
                        Export CSV
                      </button>
                    )}
                  </div>
                  <div className="clip-grid">
                    {m.clips.map((c, k) => (
                      <ClipCard key={`${c.sermon_id}-${c.start_seconds}`} c={c} delay={k * 60} />
                    ))}
                  </div>
                </div>
                {i === lastIdx && !loading && <RefineChips items={m.clips} onPick={send} />}
              </div>
            ) : m.mode === 'list' ? (
              <div key={i} className="ra-body">
                <div className="ra-srcs ra-list">
                  <h4>
                    {m.kind === 'verse'
                      ? m.sources.length
                        ? `${m.sources.length} sermon${m.sources.length === 1 ? '' : 's'} citing ${m.topic}`
                        : `No sermons found citing ${m.topic}`
                      : m.sources.length
                        ? `${m.sources.length} sermon${m.sources.length === 1 ? '' : 's'} on ${m.topic}`
                        : `No sermons found on ${m.topic}`}
                  </h4>
                  {m.kind === 'verse' && m.verses?.[0] && (
                    <div className="ra-pulls">
                      <VerseCard reference={m.verses[0]} />
                    </div>
                  )}
                  {m.sources.length > 0 && (
                    <div className="ra-row2">
                      {m.sources.map((s, k) => (
                        <SourceCard key={s.id} s={s} delay={k * 50} />
                      ))}
                    </div>
                  )}
                </div>
                {i === lastIdx && !loading && <RefineChips items={m.sources} onPick={send} />}
              </div>
            ) : (
              <div key={i} className={`ra-body${m.mode === 'compare' || m.mode === 'guide' ? ' structured' : ''}`}>
                <RichText text={m.content} citations={m.citations} streaming={m.streaming} />
                {m.streaming && !m.content && (
                  <p>
                    <span className="chat-cursor" />
                  </p>
                )}
                {m.streaming && (
                  <div className="ra-status">
                    <span className="ra-dot" />
                    Writing from the transcripts
                  </div>
                )}
                {(m.verses || []).length > 0 && (
                  <div className="ra-pulls">
                    {m.verses.map((v, k) => (
                      <VerseCard key={v} reference={v} delay={k * 80} />
                    ))}
                  </div>
                )}
                {(m.citations || []).length > 0 ? (
                  <Citations citations={m.citations} />
                ) : (
                  (m.sources || []).length > 0 && (
                    <div className="ra-srcs">
                      <h4>Way Church has preached on this</h4>
                      <div className="ra-row2">
                        {m.sources.map((s, k) => (
                          <SourceCard key={s.id} s={s} delay={k * 80} />
                        ))}
                      </div>
                    </div>
                  )
                )}
                {i === lastIdx && !loading && !m.streaming && <RefineChips items={m.sources || []} onPick={send} />}
              </div>
            )
          )}
          {loading && !messages.some((m) => m.streaming) && (
            <div className="ra-status">
              <span className="ra-dot" />
              Searching every transcript
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && <div className="empty">{error}</div>}

      {started && <div className="ac-follow">{bar}</div>}
    </main>
  );
}
