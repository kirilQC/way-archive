import Link from 'next/link';

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
        <Link key={s.id} href={`/sermon/${s.id}`} className="card">
          <div className="thumb">
            {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
            {s.duration_seconds ? (
              <div className="duration">{Math.floor(s.duration_seconds / 60)} min</div>
            ) : null}
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
  );
}
