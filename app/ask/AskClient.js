'use client';

import { useState } from 'react';
import Link from 'next/link';

const EXAMPLES = [
  'What has Way taught about money?',
  'How should I handle anxiety?',
  'What does the church say about dating and relationships?',
  'How do I hear God\u2019s voice?',
];

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AskClient() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { answer, sources } | { error }

  const ask = async (q) => {
    const text = (q || question).trim();
    if (text.length < 5 || loading) return;
    setQuestion(text);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { error: data.error || 'Something went wrong.' });
    } catch {
      setResult({ error: 'Something went wrong.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Ask anything the church has ever preached on…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button className="chip on" onClick={() => ask()} disabled={loading}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {!result && !loading && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="empty">Reading the archive…</div>}

      {result?.error && <div className="empty">{result.error}</div>}

      {result?.answer && (
        <div className="ask-result">
          <div className="panel-box">
            <h4>Answer</h4>
            {result.answer.split('\n').filter(Boolean).map((p, i) => (
              <p key={i} className="panel-text" style={{ marginBottom: 12 }}>
                {p}
              </p>
            ))}
          </div>
          {result.sources?.length > 0 && (
            <div className="panel-box" style={{ marginTop: 14 }}>
              <h4>From these sermons</h4>
              {result.sources.map((s) => (
                <Link key={s.id} href={`/sermon/${s.id}`} className="ask-source">
                  <b>{s.title}</b>
                  <span>
                    {[s.speaker, formatDate(s.date)].filter(Boolean).join(' · ')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
