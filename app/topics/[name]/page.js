import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonGrid from '../../components/SermonGrid.js';

export const dynamic = 'force-dynamic';

export default async function TopicDetail({ params }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);

  const { data: sermons } = await db()
    .from('sermons')
    .select('id,title,date,thumbnail,duration_seconds,summary,verses,topics,speaker')
    .eq('status', 'published')
    .contains('topics', [name])
    .order('date', { ascending: false });

  if (!sermons?.length) notFound();

  // Key scriptures across this topic (primary verse of each sermon, deduped)
  const verses = [];
  const seen = new Set();
  for (const s of sermons) {
    const v = (s.verses || [])[0];
    if (v && !seen.has(v.reference)) {
      seen.add(v.reference);
      verses.push(v.reference);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <Link href="/topics" className="back">
          ← All topics
        </Link>
        <div className="kicker" style={{ marginTop: 18 }}>
          Topic · {sermons.length} sermon{sermons.length === 1 ? '' : 's'}
        </div>
        <h1>
          <em>{name}</em>
        </h1>
        {verses.length > 0 && (
          <div className="tags" style={{ marginTop: 18 }}>
            {verses.slice(0, 8).map((r) => (
              <span key={r} className="tag book">
                {r}
              </span>
            ))}
          </div>
        )}
      </section>
      <div style={{ marginTop: 8 }}>
        <SermonGrid sermons={sermons} />
      </div>
    </main>
  );
}
