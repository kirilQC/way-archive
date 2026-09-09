import { db } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const q = new URL(request.url).searchParams.get('q')?.trim();
  if (!q || q.length < 2) return Response.json({ results: [] });

  const { data, error } = await db().rpc('search_sermons', { q });
  if (error) {
    return Response.json({ results: [], error: error.message }, { status: 500 });
  }
  return Response.json({ results: data || [] });
}
