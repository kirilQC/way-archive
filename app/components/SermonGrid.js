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

export default function SermonGrid({ sermons }) {
  return (
    <div className="grid">
      {sermons.map((s) => (
        <Link key={s.id} href={`/sermon/${s.id}`} className="card reveal">
          <div className="thumb">
            {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
            {s.duration_seconds ? (
              <div className="duration">{Math.floor(s.duration_seconds / 60)} min</div>
            ) : null}
          </div>
          <div className="card-body">
            <div className="date">{formatDate(s.date)}</div>
            <h3>{s.title}</h3>
            <p>{noDashes(s.summary?.split('. ').slice(0, 2).join('. '))}.</p>
            <div className="card-meta">
              {(s.verses || []).slice(0, 1).map((v) => (
                <div key={v.reference} className="verse-line">
                  {v.reference}
                </div>
              ))}
              {(s.topics || []).length > 0 && (
                <div className="topic-line">
                  {(s.topics || []).slice(0, 2).map((t, i) => (
                    <span key={t}>
                      {i > 0 && <i>·</i>}
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
