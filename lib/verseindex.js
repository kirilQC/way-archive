// Storage + lookup for the spoken-verse index (see lib/verses.js for extraction).
import { db } from './supabase.js';
import { extractMentions, formatRef } from './verses.js';

// Replaces a sermon's verse mentions. Safe to rerun.
export async function indexVerses({ id, transcript_segments }) {
  const mentions = extractMentions(transcript_segments);
  const supabase = db();
  const { error: delErr } = await supabase.from('sermon_verse_mentions').delete().eq('sermon_id', id);
  if (delErr) throw new Error(`verse delete failed: ${delErr.message}`);
  if (!mentions.length) return 0;
  const { error } = await supabase.from('sermon_verse_mentions').insert(mentions.map((m) => ({ sermon_id: id, ...m })));
  if (error) throw new Error(`verse insert failed: ${error.message}`);
  return mentions.length;
}

const overlaps = (m, v) => {
  if (!v.verse_start) return true; // asked for the whole chapter
  if (!m.verse_start) return false;
  const aEnd = m.verse_end || m.verse_start;
  const bEnd = v.verse_end || v.verse_start;
  return m.verse_start <= bEnd && v.verse_start <= aEnd;
};

// Every sermon where `ref` ({ book, chapter, verse_start, verse_end }) was said aloud, plus
// sermons whose analyzed verse list cites it. Exact verse hits first, then chapter-level ones.
// Returns sermons shaped like deepSearch results: { id, title, ..., moments: [{ start_seconds, note, quote }] }
export async function verseSearch(ref) {
  const { data: rows, error } = await db()
    .from('sermon_verse_mentions')
    .select('sermon_id,chapter,verse_start,verse_end,start_seconds,snippet')
    .eq('book', ref.book)
    .eq('chapter', ref.chapter)
    .order('start_seconds');
  if (error) throw new Error(`verse lookup failed: ${error.message}`);

  // Analyzed verse lists catch references the captions garbled
  const { data: cited } = await db()
    .from('sermons')
    .select('id,verses')
    .eq('status', 'published')
    .contains('bible_books', [ref.book]);
  const refRe = new RegExp(`^${ref.book.replace(/\s/g, '\\s')}\\s+${ref.chapter}(?::(\\d+)(?:-(\\d+))?)?\\b`);
  const citedIds = new Set();
  for (const s of cited || []) {
    for (const v of s.verses || []) {
      const m = String(v.reference || '').match(refRe);
      if (m && overlaps({ verse_start: m[1] ? Number(m[1]) : null, verse_end: m[2] ? Number(m[2]) : null }, ref)) citedIds.add(s.id);
    }
  }

  const bySermon = new Map();
  for (const r of rows || []) {
    const exact = ref.verse_start ? overlaps(r, ref) : true;
    const chapterOnly = ref.verse_start && !r.verse_start; // "Romans 8" when asked for 8:28
    if (!exact && !chapterOnly) continue;
    if (!bySermon.has(r.sermon_id)) bySermon.set(r.sermon_id, { exact: false, moments: [] });
    const g = bySermon.get(r.sermon_id);
    g.exact ||= exact;
    if (g.moments.length < 3) {
      g.moments.push({
        start_seconds: r.start_seconds,
        note: exact ? `Says ${formatRef({ book: ref.book, ...r })}` : `Opens ${ref.book} ${ref.chapter}`,
        quote: r.snippet,
        exact,
      });
    }
  }
  for (const id of citedIds) if (!bySermon.has(id)) bySermon.set(id, { exact: true, moments: [] });

  const ids = [...bySermon.keys()];
  if (!ids.length) return [];
  const { data: sermons } = await db()
    .from('sermons')
    .select('id,youtube_id,title,date,speaker,thumbnail')
    .in('id', ids)
    .eq('status', 'published');
  return (sermons || [])
    .map((s) => {
      const g = bySermon.get(s.id);
      // Show exact hits before chapter-level ones within a sermon
      const moments = [...g.moments.filter((m) => m.exact), ...g.moments.filter((m) => !m.exact)].slice(0, 3);
      return { ...s, exact: g.exact, moments: moments.map(({ exact, ...m }) => m) };
    })
    .sort((a, b) => Number(b.exact) - Number(a.exact) || (a.date < b.date ? 1 : -1));
}
