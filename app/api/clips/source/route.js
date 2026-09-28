// Clip source files for MP4 export (see lib/oxylabs.js).
//   POST { sermon_id, start_seconds, end_seconds } -> { status, url?, job?, folder, from, quality }
//   GET  ?job=&folder=                              -> { status, url?, error? }
import { db } from '../../../../lib/supabase.js';
import { oxylabsConfigured, requestSource, sourceStatus } from '../../../../lib/oxylabs.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!oxylabsConfigured()) return Response.json({ error: 'Video downloads are not configured yet' }, { status: 503 });
  const { sermon_id, start_seconds, end_seconds } = await request.json();
  const start = Number(start_seconds);
  const end = Number(end_seconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 9.95 || end - start > 60.05) {
    return Response.json({ error: 'Invalid clip range' }, { status: 400 });
  }
  const { data: s } = await db().from('sermons').select('youtube_id').eq('id', sermon_id).single();
  if (!s?.youtube_id) return Response.json({ error: 'Sermon not found' }, { status: 404 });
  try {
    return Response.json(await requestSource(s.youtube_id, start, end));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}

export async function GET(request) {
  if (!oxylabsConfigured()) return Response.json({ error: 'Video downloads are not configured yet' }, { status: 503 });
  const p = new URL(request.url).searchParams;
  const folder = p.get('folder') || '';
  if (!/^clips\/[\w-]{6,20}\/\d+-\d+-\d+$/.test(folder)) return Response.json({ error: 'Bad folder' }, { status: 400 });
  try {
    return Response.json(await sourceStatus(p.get('job'), folder));
  } catch (err) {
    return Response.json({ status: 'failed', error: err.message });
  }
}
