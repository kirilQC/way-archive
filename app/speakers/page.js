import Link from 'next/link';
import { db } from '../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

export default async function SpeakersPage() {
  const { data } = await db()
    .from('sermons')
    .select('id,date,thumbnail,speaker,topics')
    .eq('status', 'published')
    .not('speaker', 'is', null)
    .order('date', { ascending: false });

  const groups = new Map();
  for (const s of data || []) {
    const name = s.speaker?.trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  const speakers = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <h1>
          Who&apos;s <em>preaching.</em>
        </h1>
      </section>

      <div className="grid" style={{ marginTop: 40 }}>
        {speakers.map(([name, list]) => {
          const topics = new Map();
          for (const s of list) for (const t of s.topics || []) topics.set(t, (topics.get(t) || 0) + 1);
          const top = [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          return (
            <Link key={name} href={`/speakers/${encodeURIComponent(name)}`} className="card">
              <div className="thumb">
                {list[0].thumbnail && <img src={list[0].thumbnail} alt="" loading="lazy" />}
                <div className="duration">
                  {list.length} sermon{list.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="card-body">
                <h3>{name}</h3>
                <div className="tags" style={{ marginTop: 10 }}>
                  {top.map(([t]) => (
                    <span key={t} className="tag topic">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
