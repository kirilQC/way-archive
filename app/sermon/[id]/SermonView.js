'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Verse({ reference, quote }) {
  const [passage, setPassage] = useState(null); // { text, translation } | { error }

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

  return (
    <div className="verse open">
      <b>{reference}</b>
      {passage?.text ? (
        <span>
          “{passage.text}
          {passage.truncated ? '…' : '”'} <i className="verse-trans">— {passage.translation}</i>
        </span>
      ) : (
        <span>{quote}</span>
      )}
    </div>
  );
}

// Group raw caption segments into ~45-second paragraphs
function groupSegments(segments, windowSeconds = 45) {
  const blocks = [];
  let current = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= windowSeconds) {
      current = { start: seg.start, text: seg.text };
      blocks.push(current);
    } else {
      current.text += ' ' + seg.text;
    }
  }
  return blocks;
}

function Transcript({ sermonId, onSeek }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { segments } | { text } | { error }

  const toggle = async () => {
    setOpen(!open);
    if (data || open) return;
    try {
      const res = await fetch(`/api/transcript?id=${sermonId}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setData({ error: true });
    }
  };

  return (
    <>
      <button className="chip transcript-toggle" onClick={toggle}>
        {open ? 'Hide full transcript' : 'Show full transcript'}
      </button>
      {open && !data && <p className="panel-text">Loading transcript…</p>}
      {open && data?.error && <p className="panel-text">Transcript unavailable.</p>}
      {open && data?.segments && (
        <div className="transcript">
          {groupSegments(data.segments).map((b, i) => (
            <div key={i} className="transcript-block">
              <button className="hl-time" onClick={() => onSeek(b.start)}>
                {formatTime(b.start)}
              </button>
              <p>{b.text}</p>
            </div>
          ))}
        </div>
      )}
      {open && data && !data.segments && data.text && (
        <div className="transcript">
          <p className="panel-text">{data.text}</p>
        </div>
      )}
    </>
  );
}

export default function SermonView({ sermon: s }) {
  const iframeRef = useRef(null);
  const minutes = s.duration_seconds ? `${Math.floor(s.duration_seconds / 60)} min` : null;

  const seekTo = (seconds) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    for (const func of [['seekTo', [seconds, true]], ['playVideo', []]]) {
      win.postMessage(JSON.stringify({ event: 'command', func: func[0], args: func[1] }), '*');
    }
    iframeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <main className="detail">
      <Link href="/" className="back">
        ← All sermons
      </Link>
      <div className="kicker">{formatDate(s.date)}</div>
      <h1>{s.title}</h1>
      <div className="meta">
        {s.speaker && (
          <>
            <Link href={`/speakers/${encodeURIComponent(s.speaker)}`} className="meta-link">
              {s.speaker}
            </Link>
            {' · '}
          </>
        )}
        {[minutes, (s.verses || [])[0]?.reference].filter(Boolean).join(' · ')}
        {s.series && (
          <>
            {' · '}
            <Link href={`/series/${encodeURIComponent(s.series)}`} className="meta-link">
              {s.series} series
            </Link>
          </>
        )}
      </div>

      <div className="video-wrap">
        <iframe
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${s.youtube_id}?enablejsapi=1`}
          title={s.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      <div className="cols">
        <div className="panel-box">
          <h4>Summary</h4>
          <p className="panel-text">{s.summary}</p>

          {(s.highlights || []).length > 0 && (
            <>
              <h4 className="mt">Highlights</h4>
              {s.highlights.map((h, i) =>
                typeof h === 'string' ? (
                  <div key={i} className="hl">
                    {h}
                  </div>
                ) : (
                  <button key={i} className="hl hl-jump" onClick={() => seekTo(h.start_seconds)}>
                    <span className="hl-time">{formatTime(h.start_seconds)}</span>
                    <span>{h.text}</span>
                  </button>
                )
              )}
            </>
          )}

          {s.notes && (
            <>
              <h4 className="mt">Notes & Takeaways</h4>
              <p className="panel-text">{s.notes}</p>
            </>
          )}

          <h4 className="mt">Transcript</h4>
          <Transcript sermonId={s.id} onSeek={seekTo} />
        </div>

        <div className="panel-box">
          {(s.verses || []).length > 0 && (
            <>
              <h4>Key Scriptures</h4>
              {s.verses.map((v, i) => (
                <Verse key={i} reference={v.reference} quote={v.quote} />
              ))}
            </>
          )}

          {(s.topics || []).length > 0 && (
            <>
              <h4 className="mt">Topics</h4>
              <div className="tags">
                {s.topics.map((t) => (
                  <span key={t} className="tag topic">
                    {t}
                  </span>
                ))}
              </div>
            </>
          )}

          {(s.bible_books || []).length > 0 && (
            <>
              <h4 className="mt">Books</h4>
              <div className="tags">
                {s.bible_books.map((b) => (
                  <span key={b} className="tag book">
                    {b}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
