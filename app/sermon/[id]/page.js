import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonView from './SermonView.js';

export const dynamic = 'force-dynamic';

const REL_COLS = 'id,title,date,thumbnail,duration_seconds,summary,topics,verses,speaker';

async function getRelated(sermon) {
  const scores = new Map(); // id -> { row, score }
  const bump = (rows, weight) => {
    for (const r of rows || []) {
      if (r.id === sermon.id) continue;
      const entry = scores.get(r.id) || { row: r, score: 0 };
      entry.score += typeof weight === 'function' ? weight(r) : weight;
      scores.set(r.id, entry);
    }
  };

  const queries = [];
  if (sermon.series) {
    queries.push(
      db().from('sermons').select(REL_COLS).eq('status', 'published')
        .eq('series', sermon.series).neq('id', sermon.id).limit(8)
        .then(({ data }) => bump(data, 3))
    );
  }
  if ((sermon.topics || []).length) {
    queries.push(
      db().from('sermons').select(REL_COLS).eq('status', 'published')
        .overlaps('topics', sermon.topics).neq('id', sermon.id).limit(16)
        .then(({ data }) =>
          bump(data, (r) => (r.topics || []).filter((t) => sermon.topics.includes(t)).length)
        )
    );
  }
  if (sermon.speaker) {
    queries.push(
      db().from('sermons').select(REL_COLS).eq('status', 'published')
        .eq('speaker', sermon.speaker).neq('id', sermon.id)
        .order('date', { ascending: false }).limit(8)
        .then(({ data }) => bump(data, 1))
    );
  }
  await Promise.all(queries);

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || (a.row.date < b.row.date ? 1 : -1))
    .slice(0, 3)
    .map((e) => e.row);
}

export default async function SermonPage({ params }) {
  const { id } = await params;
  const cols = 'id,youtube_id,title,date,thumbnail,duration_seconds,summary,highlights,notes,bible_books,verses,topics,speaker';
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

  const related = await getRelated(sermon);

  return <SermonView sermon={sermon} related={related} />;
}
