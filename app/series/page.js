import Link from 'next/link';
import { db } from '../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

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
        <h1>
          Sermon <em>series.</em>
        </h1>
      </section>

      {series.length === 0 ? (
        <div className="empty">No series detected yet.</div>
      ) : (
        <div className="series-list">
          {series.map(([name, list], i) => {
            const first = list[list.length - 1];
            const last = list[0];
            const speakers = [...new Set(list.map((s) => s.speaker).filter(Boolean))].slice(0, 3);
            return (
              <Link
                key={name}
                href={`/series/${encodeURIComponent(name)}`}
                className={`series-row${i % 2 ? ' flip' : ''}`}
              >
                <div className="series-blur">{last.thumbnail && <img src={last.thumbnail} alt="" />}</div>
                <div className="series-txt">
                  <div className="series-caps">
                    {monthYear(first.date)}
                    {monthYear(first.date) !== monthYear(last.date) ? ` - ${monthYear(last.date)}` : ''}
                  </div>
                  <h3>{name}</h3>
                  <div className="series-n">{list.length} parts</div>
                  {speakers.length > 0 && (
                    <div className="series-speakers">
                      {speakers.map((sp, j) => (
                        <span key={sp}>
                          {j > 0 && <i>·</i>}
                          {sp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="series-art">
                  {last.thumbnail && <img src={last.thumbnail} alt="" loading="lazy" />}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
