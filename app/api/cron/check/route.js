import { ingestLatest } from '../../../../lib/ingest.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await ingestLatest({ limit: 10 });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: String(err.message || err) }, { status: 500 });
  }
}
