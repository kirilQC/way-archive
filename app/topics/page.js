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

      <div className="topic-bento">
        {topics.map(([name, { count, thumbnail }], i) => {
          const size = i === 0 ? ' big' : i === 3 || i === 6 ? ' wide' : '';
          return (
            <Link
              key={name}
              href={`/topics/${encodeURIComponent(name)}`}
              className={`topic-cell reveal${size}`}
            >
              {thumbnail && <img src={thumbnail} alt="" loading="lazy" />}
              <span className="lab">
                <b>{name}</b>
                <span>
                  {count} sermon{count === 1 ? '' : 's'}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
