import { db } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  const { data } = await db()
    .from('sermons')
    .select('transcript,transcript_segments')
    .eq('id', id)
    .single();
  if (!data) return Response.json({ error: 'not found' }, { status: 404 });

  return Response.json({
    segments: data.transcript_segments || null,
    text: data.transcript_segments ? null : data.transcript,
  });
}
