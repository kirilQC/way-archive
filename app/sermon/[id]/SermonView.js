'use client';

import { useRef } from 'react';
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
        {[s.speaker, minutes, (s.verses || [])[0]?.reference].filter(Boolean).join(' · ')}
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
        </div>

        <div className="panel-box">
          {(s.verses || []).length > 0 && (
            <>
              <h4>Key Scriptures</h4>
              {s.verses.map((v, i) => (
                <div key={i} className="verse">
                  <b>{v.reference}</b>
                  <span>{v.quote}</span>
                </div>
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
