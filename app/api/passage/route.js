// Returns the actual text of a scripture reference, e.g. ?ref=Psalm 34:1-3
// Primary source: bolls.life (NLT). Fallback: bible-api.com (WEB).

const BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
  '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
const ALIASES = { psalm: 'Psalms', 'song of songs': 'Song of Solomon', canticles: 'Song of Solomon' };

function bookId(name) {
  const clean = name.trim().toLowerCase();
  const canonical = ALIASES[clean] || BOOKS.find((b) => b.toLowerCase() === clean);
  const idx = BOOKS.indexOf(canonical || '');
  return idx === -1 ? null : idx + 1;
}

import { noDashes } from '../../../lib/text.js';

const strip = (html) => noDashes(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

export async function GET(request) {
  const ref = new URL(request.url).searchParams.get('ref')?.trim();
  if (!ref) return Response.json({ error: 'ref required' }, { status: 400 });

  // "1 Corinthians 13:4-8" -> book="1 Corinthians", chapter=13, from=4, to=8
  const m = ref.match(/^([1-3]?\s?[A-Za-z][A-Za-z\s]*?)\s+(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/);
  const headers = { 'Cache-Control': 'public, s-maxage=31536000, immutable' };

  if (m) {
    const [, book, chapter, fromStr, toStr] = m;
    const id = bookId(book);
    if (id) {
      try {
        const res = await fetch(`https://bolls.life/get-text/NLT/${id}/${chapter}/`);
        if (res.ok) {
          const verses = await res.json();
          if (Array.isArray(verses) && verses.length) {
            const from = fromStr ? parseInt(fromStr, 10) : 1;
            const to = toStr ? parseInt(toStr, 10) : fromStr ? from : Math.min(from + 7, verses.length);
            const slice = verses.filter((v) => v.verse >= from && v.verse <= to);
            if (slice.length) {
              return Response.json(
                {
                  text: slice.map((v) => strip(v.text)).join(' '),
                  translation: 'NLT',
                  truncated: !fromStr && verses.length > to,
                },
                { headers }
              );
            }
          }
        }
      } catch {
        // fall through to bible-api.com
      }
    }
  }

  try {
    const res = await fetch(`https://bible-api.com/${encodeURIComponent(ref)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.text) {
        return Response.json(
          { text: noDashes(data.text.trim().replace(/\s+/g, ' ')), translation: data.translation_name || 'WEB' },
          { headers }
        );
      }
    }
  } catch {
    // no source worked
  }
  return Response.json({ error: 'passage not found' }, { status: 404 });
}
