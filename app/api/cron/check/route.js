import { ingestLatest } from '../../../../lib/ingest.js';
import { cleanupSources } from '../../../../lib/oxylabs.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await ingestLatest({ limit: 10 });
    // Downloaded clip sources are only needed while exporting; keep the bucket small
    const sourcesRemoved = await cleanupSources(7).catch(() => 0);
    return Response.json({ ok: true, ...result, sourcesRemoved });
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
