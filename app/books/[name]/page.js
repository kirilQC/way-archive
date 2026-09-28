import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';
import SermonGrid from '../../components/SermonGrid.js';

export const dynamic = 'force-dynamic';

export default async function BookDetail({ params }) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);

  const { data: sermons } = await db()
    .from('sermons')
    .select('id,title,date,thumbnail,duration_seconds,summary,verses,topics,speaker')
    .eq('status', 'published')
    .contains('bible_books', [name])
    .order('date', { ascending: false });

  if (!sermons?.length) notFound();

  // Most-preached chapters, from references said aloud (spoken-verse index)
  let chapters = [];
  const { data: mentions, error: mErr } = await db()
    .from('sermon_verse_mentions')
    .select('sermon_id,chapter')
    .eq('book', name)
    .range(0, 4999);
  if (!mErr && mentions?.length) {
    const bySermon = new Map(); // chapter -> Set(sermon ids)
    for (const m of mentions) {
      if (!bySermon.has(m.chapter)) bySermon.set(m.chapter, new Set());
      bySermon.get(m.chapter).add(m.sermon_id);
    }
    chapters = [...bySermon.entries()]
      .map(([chapter, ids]) => ({ chapter, count: ids.size }))
      .sort((a, b) => b.count - a.count || a.chapter - b.chapter)
      .slice(0, 12);
  }

  // Passages preached from this book (deduped)
  const refs = [];
  const seen = new Set();
  for (const s of sermons) {
    for (const v of s.verses || []) {
      const r = v.reference || '';
      if (r.startsWith(name) && !seen.has(r)) {
        seen.add(r);
        refs.push(r);
      }
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <Link href="/books" className="back">
          ← All books
        </Link>
        <div className="kicker" style={{ marginTop: 18 }}>
          Book · {sermons.length} sermon{sermons.length === 1 ? '' : 's'}
        </div>
        <h1>
          <em>{name}</em>
        </h1>
        {chapters.length > 0 && (
          <div className="chapter-chips">
            <span>Most preached chapters</span>
            {chapters.map((c) => (
              <Link
                key={c.chapter}
                href={`/ask?q=${encodeURIComponent(`Every time ${name} ${c.chapter} was preached`)}`}
                className="chapter-chip"
              >
                {name} {c.chapter}
                <i>{c.count}</i>
              </Link>
            ))}
          </div>
        )}
        {refs.length > 0 && chapters.length === 0 && (
          <div className="tags" style={{ marginTop: 18 }}>
            {refs.slice(0, 8).map((r) => (
              <span key={r} className="tag book">
                {r}
              </span>
            ))}
          </div>
        )}
      </section>
      <div style={{ marginTop: 8 }}>
        <SermonGrid sermons={sermons} />
      </div>
    </main>
  );
}
