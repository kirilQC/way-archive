import Link from 'next/link';
import { db } from '../../lib/supabase.js';
import { BOOKS, NT_START } from '../../lib/books.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

function heat(count, max) {
  if (!count) return 'transparent';
  const a = 0.08 + 0.5 * Math.pow(count / max, 0.45);
  return `rgba(140, 174, 242, ${a.toFixed(3)})`;
}

function BookMap({ books, counts, max }) {
  return (
    <div className="books-map">
      {books.map((name) => {
        const count = counts.get(name) || 0;
        const inner = (
          <>
            <b>{name}</b>
            <span>{count > 0 ? `${count} ${count === 1 ? 'sermon' : 'sermons'}` : ''}</span>
          </>
        );
        return count > 0 ? (
          <Link
            key={name}
            href={`/books/${encodeURIComponent(name)}`}
            className="book-cell"
            style={{ background: heat(count, max) }}
          >
            {inner}
          </Link>
        ) : (
          <div key={name} className="book-cell off">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export default async function BooksPage() {
  const { data } = await db()
    .from('sermons')
    .select('bible_books')
    .eq('status', 'published');

  const counts = new Map();
  for (const s of data || []) {
    for (const b of s.bible_books || []) {
      counts.set(b, (counts.get(b) || 0) + 1);
    }
  }
  const max = Math.max(1, ...counts.values());
  const top = BOOKS.find((b) => counts.get(b) === max) || 'John';

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Books</div>
        <h1>
          {top}, preached <em>{max} times.</em>
        </h1>
      </section>

      <div className="books-map-wrap">
        <h4 className="books-heading">Old Testament</h4>
        <BookMap books={BOOKS.slice(0, NT_START)} counts={counts} max={max} />
        <h4 className="books-heading nt">New Testament</h4>
        <BookMap books={BOOKS.slice(NT_START)} counts={counts} max={max} />
      </div>
    </main>
  );
}
