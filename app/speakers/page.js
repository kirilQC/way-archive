import Link from 'next/link';
import { db } from '../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

export default async function SpeakersPage() {
  const { data } = await db()
    .from('sermons')
    .select('id,date,thumbnail,speaker')
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
        {speakers.map(([name, list]) => (
          <Link key={name} href={`/speakers/${encodeURIComponent(name)}`} className="speaker-card">
            {list[0].thumbnail && <img src={list[0].thumbnail} alt="" loading="lazy" />}
            <div className="speaker-shade" />
            <div className="speaker-info">
              <div className="speaker-count">
                {list.length} sermon{list.length === 1 ? '' : 's'}
              </div>
              <h3>{name}</h3>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
