'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  'What has Way Church taught about money?',
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

function VerseCard({ reference }) {
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
    <div className="verse open">
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

export default function AskClient() {
  // messages: { role: 'user'|'assistant', content, verses?, sources? }
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);

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
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error('failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const DONE = '###DONE###';
      let buffer = '';
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const idx = buffer.indexOf(DONE);
        if (idx !== -1) {
          // Final tail: { verses, sources }
          const answerText = buffer.slice(0, idx).trimEnd();
          let tail = { verses: [], sources: [] };
          try {
            tail = JSON.parse(buffer.slice(idx + DONE.length));
          } catch {}
          setMessages([
            ...next,
            { role: 'assistant', content: answerText, verses: tail.verses, sources: tail.sources },
          ]);
          finished = true;
        } else {
          // Stream the growing answer live
          const partial = buffer;
          setMessages([...next, { role: 'assistant', content: partial, streaming: true }]);
        }
      }
      if (!finished) {
        setMessages([...next, { role: 'assistant', content: buffer.trimEnd() }]);
      }
    } catch {
      setError('Something went wrong. Try again.');
      setMessages(next);
      setInput(q);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bible-chat">
      {messages.length > 0 && (
        <div className="chat-log">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="chat-user">
                {m.content}
              </div>
            ) : (
              <div key={i} className="chat-answer panel-box">
                {m.content.split('\n').filter(Boolean).map((p, j, arr) => (
                  <p key={j} className="panel-text" style={{ marginBottom: 10 }}>
                    {p}
                    {m.streaming && j === arr.length - 1 && <span className="chat-cursor" />}
                  </p>
                ))}
                {m.streaming && !m.content && (
                  <p className="panel-text">
                    <span className="chat-cursor" />
                  </p>
                )}
                {m.streaming && (
                  <p className="chat-status">Writing from Scripture…</p>
                )}
                {(m.verses || []).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    {m.verses.map((v) => (
                      <VerseCard key={v} reference={v} />
                    ))}
                  </div>
                )}
                {(m.sources || []).length > 0 && (
                  <>
                    <h4 className="mt">Way Church has preached on this</h4>
                    {m.sources.map((s) => (
                      <Link key={s.id} href={`/sermon/${s.id}`} className="ask-source">
                        {s.thumbnail && (
                          <img className="ask-source-thumb" src={s.thumbnail} alt="" loading="lazy" />
                        )}
                        <span className="ask-source-body">
                          <b>{s.title}</b>
                          <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
                        </span>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )
          )}
          {loading && !messages.some((m) => m.streaming) && (
            <div className="chat-answer panel-box panel-text chat-thinking">
              Searching the archive<span className="dots" />
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {error && <div className="empty">{error}</div>}

      <div className="toolbar" style={{ marginTop: messages.length ? 18 : 34 }}>
        <input
          className="search"
          placeholder="Ask about the Bible or anything Way Church has preached…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="chip on" onClick={() => send()} disabled={loading}>
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </div>

      {messages.length === 0 && !loading && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => send(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      <p className="chat-disclaimer">
        AI assistant, not a pastor. Verses shown are real NLT text. For anything serious, talk to
        your church community.
      </p>
    </div>
  );
}
