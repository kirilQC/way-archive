import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import ClipStudio from './ClipStudio.js';
import { oxylabsConfigured } from '../../../lib/oxylabs.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Way Archive' };

export default async function StudioPage({ params, searchParams }) {
  const { id } = await params;
  const { clip } = await searchParams;
  const { data: sermon } = await db()
    .from('sermons')
    .select('id,youtube_id,title,date,speaker,thumbnail,duration_seconds,transcript_segments')
    .eq('id', id)
    .eq('status', 'published')
    .single();
  if (!sermon) notFound();
  const { data: clips } = await db()
    .from('sermon_clips')
    .select('id,kind,clip_type,rank,start_seconds,end_seconds,hook,caption,transcript,created_by,created_at')
    .eq('sermon_id', id)
    .order('kind')
    .order('rank');
  return (
    <ClipStudio
      sermon={sermon}
      initialClips={clips || []}
      initialClipId={clip ? Number(clip) : null}
      downloadsEnabled={oxylabsConfigured()}
    />
  );
}
