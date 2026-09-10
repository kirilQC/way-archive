import { db } from '../lib/supabase.js';
import Archive from './components/Archive.js';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { data: sermons, error } = await db()
    .from('sermons')
    .select('id,youtube_id,title,date,thumbnail,duration_seconds,summary,bible_books,verses,topics,speaker')
    .eq('status', 'published')
    .order('date', { ascending: false });

  if (error) {
    return <div className="empty">Could not load sermons: {error.message}</div>;
  }

  const list = sermons || [];
  const books = new Set(list.flatMap((s) => s.bible_books || []));

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Sermon Archive</div>
        <h1>
          Find any moment,
          <br />
          <em>from any Sunday.</em>
        </h1>
        <div className="stats">
          <div className="stat">
            <b>{list.length}</b>
            <span>sermons archived</span>
          </div>
          <div className="stat">
            <b>{books.size}</b>
            <span>books of the Bible</span>
          </div>
        </div>
      </section>
      <Archive sermons={list} />
    </main>
  );
}
