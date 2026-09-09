import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonGrid from '../../components/SermonGrid.js';

export const dynamic = 'force-dynamic';

export default async function SpeakerDetail({ params }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);

  const { data: sermons } = await db()
    .from('sermons')
    .select('id,title,date,thumbnail,duration_seconds,summary,verses,topics,speaker')
    .eq('status', 'published')
    .eq('speaker', name)
    .order('date', { ascending: false });

  if (!sermons?.length) notFound();

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <Link href="/speakers" className="back">
          ← All speakers
        </Link>
        <div className="kicker" style={{ marginTop: 18 }}>
          {sermons.length} sermon{sermons.length === 1 ? '' : 's'}
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
