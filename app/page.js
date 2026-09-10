import Link from 'next/link';
import { db } from '../lib/supabase.js';
import SermonGrid from './components/SermonGrid.js';
import { noDashes } from '../lib/text.js';

export const dynamic = 'force-dynamic';

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

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
  const [latest, ...rest] = list;

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="hero-row">
          <div className="hero-left">
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
          </div>
          {latest && (
            <Link href={`/sermon/${latest.id}`} className="featured hero-featured">
              <div className="featured-thumb">
                {latest.thumbnail && <img src={latest.thumbnail} alt="" />}
                {latest.duration_seconds ? (
                  <div className="duration">{Math.floor(latest.duration_seconds / 60)} min</div>
                ) : null}
              </div>
              <div className="featured-body">
                <div className="kicker">Latest Sermon</div>
                <div className="date">{formatDate(latest.date)}</div>
                <h3>{latest.title}</h3>
                <p>{noDashes(latest.summary)}</p>
              </div>
            </Link>
          )}
        </div>
      </section>
      <div style={{ marginTop: 44 }}>
        <SermonGrid sermons={rest} />
      </div>
    </main>
  );
}
