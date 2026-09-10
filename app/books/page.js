import Link from 'next/link';
import { db } from '../../lib/supabase.js';
import { BOOKS, NT_START } from '../../lib/books.js';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Way Archive' };

function BookList({ books, counts }) {
  return (
    <div className="book-list">
      {books.map((name) => {
        const count = counts.get(name) || 0;
        const inner = (
          <>
            <span className="book-name">{name}</span>
            <span className="book-count">{count > 0 ? count : ''}</span>
          </>
        );
        return count > 0 ? (
          <Link key={name} href={`/books/${encodeURIComponent(name)}`} className="book-row">
            {inner}
          </Link>
        ) : (
          <div key={name} className="book-row off">
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
  const covered = BOOKS.filter((b) => counts.get(b)).length;

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Books</div>
        <h1>
          {covered} of 66 books, <em>preached.</em>
        </h1>
      </section>

      <div className="books-wrap">
        <div>
          <h4 className="books-heading">Old Testament</h4>
          <BookList books={BOOKS.slice(0, NT_START)} counts={counts} />
        </div>
        <div>
          <h4 className="books-heading">New Testament</h4>
          <BookList books={BOOKS.slice(NT_START)} counts={counts} />
        </div>
      </div>
    </main>
  );
}
