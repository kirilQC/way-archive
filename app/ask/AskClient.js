'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  'Show me sermons about money',
  'What does the Bible say about forgiveness?',
  'How do I pray when I don\u2019t know what to say?',
  'What has been preached on anxiety?',
];

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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

function clock(seconds) {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function SourceCard({ s, delay = 0 }) {
  if ((s.moments || []).length) {
    return (
      <div className="ask-source has-moments pop-in" style={{ animationDelay: `${delay}ms` }}>
        <Link href={`/sermon/${s.id}`} className="ask-source-head">
          {s.thumbnail && <img className="ask-source-thumb" src={s.thumbnail} alt="" loading="lazy" />}
          <span className="ask-source-body">
            <b>{(s.title || '').split('|')[0].trim()}</b>
            <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
          </span>
        </Link>
        <div className="ask-moments">
          {s.moments.map((m) => (
            <Link key={m.start_seconds} href={`/sermon/${s.id}?t=${m.start_seconds}`} className="ask-moment">
              <span className="ask-moment-t">{clock(m.start_seconds)}</span>
              <span>{m.note || 'Jump to this moment'}</span>
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
        <b>{(s.title || '').split('|')[0].trim()}</b>
        <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
      </span>
    </Link>
  );
}

export default function AskClient({ recent = [] }) {
  // messages: { role: 'user'|'assistant', content, verses?, sources? }
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
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
            verses: tail?.verses || [],
            sources: tail?.sources || [],
            mode: tail?.mode,
            topic: tail?.topic,
          },
        ]);
        setLoading(false);
      }
    }, 16);

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // List replies have no text; give the model their titles so follow-ups make sense.
          messages: next.map(({ role, content, mode, sources }) => ({
            role,
            content:
              mode === 'list'
                ? `Listed sermons: ${
                    (sources || [])
                      .map((s, i) => `${i + 1}. ${s.title}${(s.moments || []).length ? ` (${s.moments.map((m) => `${clock(m.start_seconds)} ${m.note}`).join('; ')})` : ''}`)
                      .join(' | ') || 'none found'
                  }`
                : content,
          })),
        }),
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
          // Final tail: { verses, sources }
          target = buffer.slice(0, idx).trimEnd();
          try {
            tail = JSON.parse(buffer.slice(idx + DONE.length));
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

  const bar = (
    <div className="ac-bar">
      <input
        placeholder="Ask about the Bible or anything Way Church has preached"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && send()}
      />
      <button onClick={() => send()} disabled={loading}>
        {loading ? 'Thinking…' : 'Ask'}
      </button>
    </div>
  );

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
            ) : m.mode === 'list' ? (
              <div key={i} className="ra-body">
                <div className="ra-srcs ra-list">
                  <h4>
                    {m.sources.length
                      ? `${m.sources.length} sermon${m.sources.length === 1 ? '' : 's'} on ${m.topic}`
                      : `No sermons found on ${m.topic}`}
                  </h4>
                  {m.sources.length > 0 && (
                    <div className="ra-row2">
                      {m.sources.map((s, k) => (
                        <SourceCard key={s.id} s={s} delay={k * 50} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={i} className="ra-body">
                {m.content.split('\n').filter(Boolean).map((p, j, arr) => (
                  <p key={j}>
                    {p}
                    {m.streaming && j === arr.length - 1 && <span className="chat-cursor" />}
                  </p>
                ))}
                {m.streaming && !m.content && (
                  <p>
                    <span className="chat-cursor" />
                  </p>
                )}
                {m.streaming && (
                  <div className="ra-status">
                    <span className="ra-dot" />
                    Writing from Scripture
                  </div>
                )}
                {(m.verses || []).length > 0 && (
                  <div className="ra-pulls">
                    {m.verses.map((v, k) => (
                      <VerseCard key={v} reference={v} delay={k * 80} />
                    ))}
                  </div>
                )}
                {(m.sources || []).length > 0 && (
                  <div className="ra-srcs">
                    <h4>Way Church has preached on this</h4>
                    <div className="ra-row2">
                      {m.sources.map((s, k) => (
                        <SourceCard key={s.id} s={s} delay={k * 80} />
                      ))}
                    </div>
                  </div>
                )}
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
