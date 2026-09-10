import Link from 'next/link';
import { db } from '../lib/supabase.js';
import SermonGrid from './components/SermonGrid.js';
import { noDashes } from '../lib/text.js';

export const dynamic = 'force-dynamic';

function shortDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
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
  const [latest, ...rest] = list;
  const latestTitle = latest ? latest.title.split('|')[0].trim() : '';

  return (
    <main className="home-cinema">
      {latest && (
        <Link href={`/sermon/${latest.id}`} className="stage">
          {latest.thumbnail && <img className="stage-bg" src={latest.thumbnail} alt="" />}
          <div className="stage-shade" />
          <div className="stagecopy">
            <div className="kicker">Latest Sermon · {shortDate(latest.date)}</div>
            <h1>
              {latestTitle}
              {latest.speaker ? (
                <>
                  <br />
                  <em>{latest.speaker}</em>
                </>
              ) : null}
            </h1>
            <p className="stage-sub">{noDashes(latest.summary)}</p>
            <span className="stage-play">
              ▶&nbsp;&nbsp;Watch now
              {latest.duration_seconds ? ` · ${Math.floor(latest.duration_seconds / 60)} min` : ''}
            </span>
          </div>
        </Link>
      )}
      <SermonGrid sermons={rest} />
    </main>
  );
}
