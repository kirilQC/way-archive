'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDuration(s) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m} min`;
}

export default function Archive({ sermons }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('All');
  const [book, setBook] = useState('All');

  const topics = useMemo(() => {
    const counts = new Map();
    for (const s of sermons) for (const t of s.topics || []) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [sermons]);

  const books = useMemo(
    () => [...new Set(sermons.flatMap((s) => s.bible_books || []))].sort(),
    [sermons]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sermons.filter((s) => {
      if (topic !== 'All' && !(s.topics || []).includes(topic)) return false;
      if (book !== 'All' && !(s.bible_books || []).includes(book)) return false;
      if (!q) return true;
      const haystack = [
        s.title,
        s.summary,
        s.speaker,
        ...(s.topics || []),
        ...(s.bible_books || []),
        ...(s.verses || []).map((v) => v.reference),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sermons, query, topic, book]);

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search sermons, verses, topics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="chip" value={book} onChange={(e) => setBook(e.target.value)}>
          <option value="All">Book: All</option>
          {books.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar" style={{ marginTop: 12 }}>
        <button className={`chip ${topic === 'All' ? 'on' : ''}`} onClick={() => setTopic('All')}>
          All
        </button>
        {topics.slice(0, 8).map((t) => (
          <button key={t} className={`chip ${topic === t ? 'on' : ''}`} onClick={() => setTopic(t)}>
            {t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          {sermons.length === 0
            ? 'No sermons yet — run the backfill script to fill the archive.'
            : 'Nothing matches that filter.'}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((s) => (
            <Link key={s.id} href={`/sermon/${s.id}`} className="card">
              <div className="thumb">
                {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
                <div className="duration">{formatDuration(s.duration_seconds)}</div>
              </div>
              <div className="card-body">
                <div className="date">{formatDate(s.date)}</div>
                <h3>{s.title}</h3>
                <p>{s.summary?.split('. ').slice(0, 2).join('. ')}.</p>
                <div className="tags">
                  {(s.verses || []).slice(0, 1).map((v) => (
                    <span key={v.reference} className="tag book">
                      {v.reference}
                    </span>
                  ))}
                  {(s.topics || []).slice(0, 2).map((t) => (
                    <span key={t} className="tag topic">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
