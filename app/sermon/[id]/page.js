import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonView from './SermonView.js';

export const dynamic = 'force-dynamic';

export default async function SermonPage({ params }) {
  const { id } = await params;
  const { data: sermon } = await db()
    .from('sermons')
    .select('id,youtube_id,title,date,duration_seconds,summary,highlights,notes,bible_books,verses,topics,speaker')
    .eq('id', id)
    .single();
  if (!sermon) notFound();

  return <SermonView sermon={sermon} />;
}
