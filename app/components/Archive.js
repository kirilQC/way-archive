'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { noDashes } from '../../lib/text.js';

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
  return `${Math.floor(s / 60)} min`;
}

function Tags({ sermon, max = 2 }) {
  return (
    <div className="tags">
      {(sermon.verses || []).slice(0, 1).map((v) => (
        <span key={v.reference} className="tag book">
          {v.reference}
        </span>
      ))}
      {(sermon.topics || []).slice(0, max).map((t) => (
        <span key={t} className="tag topic">
          {t}
        </span>
      ))}
    </div>
  );
}

export default function Archive({ sermons }) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('All');
  const [book, setBook] = useState('All');
  // Map of sermon id -> { snippet, rank } from full-transcript search; null = not searching
  const [searchHits, setSearchHits] = useState(null);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef(null);

  // Debounced full-transcript search against the server
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const { results } = await res.json();
        setSearchHits(new Map(results.map((r, i) => [r.id, { snippet: r.snippet, order: i }])));
      } catch (err) {
        if (err.name !== 'AbortError') setSearchHits(null); // fall back to local filtering
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

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
    let list = sermons.filter((s) => {
      if (topic !== 'All' && !(s.topics || []).includes(topic)) return false;
      if (book !== 'All' && !(s.bible_books || []).includes(book)) return false;
      return true;
    });

    if (q.length >= 2 && searchHits) {
      // Server-side full-transcript hits, in relevance order
      list = list
        .filter((s) => searchHits.has(s.id))
        .sort((a, b) => searchHits.get(a.id).order - searchHits.get(b.id).order);
    } else if (q) {
      // Fallback: local metadata search
      list = list.filter((s) =>
        [
          s.title,
          s.summary,
          s.speaker,
          ...(s.topics || []),
          ...(s.bible_books || []),
          ...(s.verses || []).map((v) => v.reference),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [sermons, query, topic, book, searchHits]);

  const isBrowsing = !query.trim() && topic === 'All' && book === 'All';
  const [latest, ...rest] = filtered;
  const gridList = isBrowsing ? rest : filtered;

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search everything ever said: titles, verses, topics, full transcripts…"
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

      {isBrowsing && latest && (
        <div className="featured-wrap">
          <Link href={`/sermon/${latest.id}`} className="featured">
            <div className="featured-thumb">
              {latest.thumbnail && <img src={latest.thumbnail} alt="" />}
              <div className="duration">{formatDuration(latest.duration_seconds)}</div>
            </div>
            <div className="featured-body">
              <div className="kicker">Latest Sermon</div>
              <div className="date">{formatDate(latest.date)}</div>
              <h3>{latest.title}</h3>
              <p>{noDashes(latest.summary)}</p>
              <Tags sermon={latest} max={3} />
            </div>
          </Link>
        </div>
      )}

      {searching && <div className="empty">Searching transcripts…</div>}

      {!searching && filtered.length === 0 ? (
        <div className="empty">
          {sermons.length === 0
            ? 'No sermons yet. Run the backfill script to fill the archive.'
            : 'Nothing matches that search.'}
        </div>
      ) : (
        <div className="grid">
          {gridList.map((s) => {
            const hit = searchHits?.get(s.id);
            return (
              <Link key={s.id} href={`/sermon/${s.id}`} className="card">
                <div className="thumb">
                  {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
                  <div className="duration">{formatDuration(s.duration_seconds)}</div>
                </div>
                <div className="card-body">
                  <div className="date">{formatDate(s.date)}</div>
                  <h3>{s.title}</h3>
                  {hit?.snippet ? (
                    <p
                      className="snippet"
                      dangerouslySetInnerHTML={{ __html: `…${noDashes(hit.snippet)}…` }}
                    />
                  ) : (
                    <p>{noDashes(s.summary?.split('. ').slice(0, 2).join('. '))}.</p>
                  )}
                  <Tags sermon={s} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
