import Link from 'next/link';
import { db } from '../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Series — Way Church Sermon Archive' };

function monthYear(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default async function SeriesPage() {
  const { data } = await db()
    .from('sermons')
    .select('id,title,date,thumbnail,series,speaker')
    .eq('status', 'published')
    .not('series', 'is', null)
    .order('date', { ascending: false });

  const groups = new Map();
  for (const s of data || []) {
    if (!groups.has(s.series)) groups.set(s.series, []);
    groups.get(s.series).push(s);
  }
  const series = [...groups.entries()].filter(([, list]) => list.length >= 2);

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Series</div>
        <h1>
          Sermon <em>series.</em>
        </h1>
      </section>

      {series.length === 0 ? (
        <div className="empty">No series detected yet.</div>
      ) : (
        <div className="grid" style={{ marginTop: 40 }}>
          {series.map(([name, list]) => {
            const first = list[list.length - 1];
            const last = list[0];
            return (
              <Link key={name} href={`/series/${encodeURIComponent(name)}`} className="card">
                <div className="thumb">
                  {last.thumbnail && <img src={last.thumbnail} alt="" loading="lazy" />}
                  <div className="duration">{list.length} parts</div>
                </div>
                <div className="card-body">
                  <div className="date">
                    {monthYear(first.date)}
                    {monthYear(first.date) !== monthYear(last.date) ? ` – ${monthYear(last.date)}` : ''}
                  </div>
                  <h3>{name}</h3>
                  <div className="tags">
                    {[...new Set(list.map((s) => s.speaker).filter(Boolean))].slice(0, 2).map((sp) => (
                      <span key={sp} className="tag topic">
                        {sp}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
