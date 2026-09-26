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

  const groups = new Map(); // topic -> sermons (newest first)
  for (const s of data || []) {
    for (const t of s.topics || []) {
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(s);
    }
  }
  // Give every tile a different image: prefer sermons where the topic is the
  // first (primary) tag, newest first, skipping thumbnails already used.
  const used = new Set();
  const topics = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, list]) => {
      const ranked = [...list].sort((a, b) => a.topics.indexOf(name) - b.topics.indexOf(name));
      const pick = ranked.find((s) => s.thumbnail && !used.has(s.thumbnail)) || ranked[0];
      used.add(pick?.thumbnail);
      return [name, { count: list.length, thumbnail: pick?.thumbnail }];
    });

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
          const size = i === 0 ? ' big' : '';
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
