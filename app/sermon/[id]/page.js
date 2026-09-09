import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonView from './SermonView.js';

export const dynamic = 'force-dynamic';

export default async function SermonPage({ params }) {
  const { id } = await params;
  const cols = 'id,youtube_id,title,date,duration_seconds,summary,highlights,notes,bible_books,verses,topics,speaker';
  let { data: sermon, error } = await db()
    .from('sermons')
    .select(`${cols},series`)
    .eq('id', id)
    .single();
  if (error?.message?.includes('series')) {
    // series column not migrated yet — render without it
    ({ data: sermon } = await db().from('sermons').select(cols).eq('id', id).single());
  }
  if (!sermon) notFound();

  return <SermonView sermon={sermon} />;
}
