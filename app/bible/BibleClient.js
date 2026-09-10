'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  'What does the Bible say about forgiveness?',
  'Who wrote the book of Hebrews?',
  'How do I pray when I don\u2019t know what to say?',
  'What happens after we die?',
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

export default function BibleClient() {
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
      const res = await fetch('/api/bible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setMessages([
        ...next,
        { role: 'assistant', content: data.answer, verses: data.verses, sources: data.sources },
      ]);
    } catch {
      setError('Something went wrong. Try again.');
      setMessages(next.slice(0, -1));
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
                {m.content.split('\n').filter(Boolean).map((p, j) => (
                  <p key={j} className="panel-text" style={{ marginBottom: 10 }}>
                    {p}
                  </p>
                ))}
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
                        <b>{s.title}</b>
                        <span>{[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}</span>
                      </Link>
                    ))}
                  </>
                )}
              </div>
            )
          )}
          {loading && <div className="chat-answer panel-box panel-text">Searching the Scriptures…</div>}
          <div ref={endRef} />
        </div>
      )}

      {error && <div className="empty">{error}</div>}

      <div className="toolbar" style={{ marginTop: messages.length ? 18 : 34 }}>
        <input
          className="search"
          placeholder="Ask a question about the Bible…"
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
