import Link from 'next/link';
import { db } from '../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

export default async function TopicsPage() {
  const { data } = await db()
    .from('sermons')
    .select('id,thumbnail,topics,date')
    .eq('status', 'published')
    .order('date', { ascending: false });

  const groups = new Map(); // topic -> { count, thumbnail }
  for (const s of data || []) {
    for (const t of s.topics || []) {
      if (!groups.has(t)) groups.set(t, { count: 0, thumbnail: s.thumbnail });
      groups.get(t).count++;
    }
  }
  const topics = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <h1>
          What&apos;s been <em>preached on.</em>
        </h1>
      </section>

      <div className="grid" style={{ marginTop: 40 }}>
        {topics.map(([name, { count, thumbnail }]) => (
          <Link key={name} href={`/topics/${encodeURIComponent(name)}`} className="card">
            <div className="thumb">
              {thumbnail && <img src={thumbnail} alt="" loading="lazy" />}
              <div className="duration">
                {count} sermon{count === 1 ? '' : 's'}
              </div>
            </div>
            <div className="card-body">
              <h3>{name}</h3>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
