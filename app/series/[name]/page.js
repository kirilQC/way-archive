import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonGrid from '../../components/SermonGrid.js';

export const dynamic = 'force-dynamic';

export default async function SeriesDetail({ params }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);

  const { data: sermons } = await db()
    .from('sermons')
    .select('id,title,date,thumbnail,duration_seconds,summary,verses,topics,speaker')
    .eq('status', 'published')
    .eq('series', name)
    .order('date', { ascending: true });

  if (!sermons?.length) notFound();

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <Link href="/series" className="back">
          ← All series
        </Link>
        <div className="kicker" style={{ marginTop: 18 }}>
          Series · {sermons.length} parts
        </div>
        <h1>
          <em>{name}</em>
        </h1>
      </section>
      <div style={{ marginTop: 8 }}>
        <SermonGrid sermons={sermons} />
      </div>
    </main>
  );
}
