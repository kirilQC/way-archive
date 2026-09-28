// Verse index: finds scripture references spoken aloud in auto-caption transcripts
// ("Romans chapter 8 verse 28", "John 3:16", "first Corinthians 13") and stores them in
// sermon_verse_mentions with the timestamp they were said. Deterministic, no AI, so
// "every time Romans 8:28 was preached" is a complete list rather than a best guess.
import { BOOKS } from './books.js';

// Chapters per book, same order as BOOKS
const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52,
  5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4, 28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5,
  3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];
export const chapterCount = (book) => CHAPTERS[BOOKS.indexOf(book)] || 0;

// Spoken names -> canonical book. Numbered books take an ordinal prefix separately.
const NAMES = {
  genesis: 'Genesis', exodus: 'Exodus', leviticus: 'Leviticus', numbers: 'Numbers',
  deuteronomy: 'Deuteronomy', joshua: 'Joshua', judges: 'Judges', ruth: 'Ruth', ezra: 'Ezra',
  nehemiah: 'Nehemiah', esther: 'Esther', job: 'Job', psalm: 'Psalms', psalms: 'Psalms',
  proverbs: 'Proverbs', proverb: 'Proverbs', ecclesiastes: 'Ecclesiastes',
  'song of solomon': 'Song of Solomon', 'song of songs': 'Song of Solomon', isaiah: 'Isaiah',
  jeremiah: 'Jeremiah', lamentations: 'Lamentations', ezekiel: 'Ezekiel', daniel: 'Daniel',
  hosea: 'Hosea', joel: 'Joel', amos: 'Amos', obadiah: 'Obadiah', jonah: 'Jonah', micah: 'Micah',
  nahum: 'Nahum', habakkuk: 'Habakkuk', zephaniah: 'Zephaniah', haggai: 'Haggai',
  zechariah: 'Zechariah', malachi: 'Malachi', matthew: 'Matthew', mark: 'Mark', luke: 'Luke',
  john: 'John', acts: 'Acts', romans: 'Romans', galatians: 'Galatians', ephesians: 'Ephesians',
  philippians: 'Philippians', colossians: 'Colossians', titus: 'Titus', philemon: 'Philemon',
  hebrews: 'Hebrews', james: 'James', jude: 'Jude', revelation: 'Revelation', revelations: 'Revelation',
};
const NUMBERED = {
  samuel: 'Samuel', kings: 'Kings', chronicles: 'Chronicles', corinthians: 'Corinthians',
  thessalonians: 'Thessalonians', timothy: 'Timothy', peter: 'Peter', john: 'John',
};
// Also ordinary words or common first names: only trusted with "chapter" or a C:V / "verse" form
const AMBIGUOUS = new Set([
  'Job', 'Mark', 'Acts', 'Numbers', 'Judges', 'James', 'Jude', 'Ruth', 'Amos', 'Joel', 'Titus',
  'Hosea', 'Micah', 'Daniel', 'Esther', 'John', 'Luke', 'Matthew', 'Jonah', 'Joshua', 'Ezra',
]);

const ORD = { 1: 1, 2: 2, 3: 3, '1st': 1, '2nd': 2, '3rd': 3, first: 1, second: 2, third: 3, one: 1, two: 2, three: 3, i: 1, ii: 2, iii: 3 };

const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const W = `(?:${[...Object.keys(TENS)].join('|')})(?:[\\s-](?:${Object.keys(ONES).join('|')}))?|${[...Object.keys(TEENS), ...Object.keys(ONES)].join('|')}`;
const NUM = `(\\d{1,3}|${W})`;

function toNum(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const [a, b] = s.split(/[\s-]+/);
  return (TENS[a] ?? TEENS[a] ?? ONES[a] ?? 0) + (b ? ONES[b] || 0 : 0) || null;
}

const nameAlt = Object.keys(NAMES).sort((a, b) => b.length - a.length).join('|');
const numberedAlt = Object.keys(NUMBERED).join('|');
const ordAlt = Object.keys(ORD).join('|');
const RE = new RegExp(
  `\\b(?:(${ordAlt})\\s+(${numberedAlt})|(${nameAlt}))\\s+((?:chapter|chap)\\s+)?${NUM}` +
    `(?:\\s*(:|\\s+verses?\\s+|\\s+)${NUM}(?:\\s*(?:-|through|to|and)\\s*${NUM})?)?\\b`,
  'gi'
);

export function formatRef({ book, chapter, verse_start, verse_end }) {
  if (!verse_start) return `${book} ${chapter}`;
  return `${book} ${chapter}:${verse_start}${verse_end && verse_end !== verse_start ? `-${verse_end}` : ''}`;
}

// Slice on word boundaries so snippets never start or end mid-word
function wordSlice(text, from, to) {
  let a = Math.max(0, from);
  let b = Math.min(text.length, to);
  if (a > 0) a = text.indexOf(' ', a) + 1 || a;
  if (b < text.length) b = text.lastIndexOf(' ', b) > a ? text.lastIndexOf(' ', b) : b;
  return text.slice(a, b).trim();
}

// segments: [{ text, start }] -> [{ book, chapter, verse_start, verse_end, start_seconds, snippet }]
export function extractMentions(segments) {
  const segs = (segments || []).filter((s) => s?.text && typeof s.start === 'number');
  let full = '';
  const offsets = []; // [charOffset, start]
  for (const s of segs) {
    offsets.push([full.length, s.start]);
    full += s.text.replace(/\s+/g, ' ').trim() + ' ';
  }
  const timeAt = (idx) => {
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid][0] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return Math.floor(offsets[lo]?.[1] ?? 0);
  };

  const out = [];
  for (const m of full.matchAll(RE)) {
    const [, ord, numbered, name, chapterWord, chStr, sep, vStr, vEndStr] = m;
    let book;
    if (numbered) {
      const n = ORD[ord.toLowerCase()];
      const base = NUMBERED[numbered.toLowerCase()];
      book = base === 'John' ? `${n} John` : `${n} ${base}`;
      if (!BOOKS.includes(book)) continue;
    } else {
      book = NAMES[name.toLowerCase()];
    }
    const chapter = toNum(chStr?.toLowerCase());
    let verse = toNum(vStr?.toLowerCase());
    let verseEnd = toNum(vEndStr?.toLowerCase());
    // A bare space between two numbers ("John 3 16") is only a verse when digits are used
    if (sep && !sep.includes(':') && !/verse/i.test(sep) && !(/^\d+$/.test(chStr) && /^\d+$/.test(vStr || ''))) {
      verse = null;
      verseEnd = null;
    }
    const strong = Boolean(chapterWord) || (sep && (sep.includes(':') || /verse/i.test(sep)) && verse);
    if (AMBIGUOUS.has(book) && !numbered && !strong) continue;
    if (!chapter || chapter > chapterCount(book)) continue;
    if (verse && verse > 176) verse = null;
    if (verseEnd && (!verse || verseEnd <= verse || verseEnd > 176)) verseEnd = null;
    const at = m.index;
    out.push({
      book,
      chapter,
      verse_start: verse || null,
      verse_end: verseEnd || null,
      start_seconds: timeAt(at),
      snippet: wordSlice(full, at - 90, at + m[0].length + 140),
    });
  }
  // Drop repeats of the same reference within a minute (preachers often say it twice)
  const kept = [];
  for (const x of out) {
    const dup = kept.some(
      (k) => k.book === x.book && k.chapter === x.chapter && (k.verse_start || 0) === (x.verse_start || 0) && Math.abs(k.start_seconds - x.start_seconds) < 60
    );
    if (!dup) kept.push(x);
  }
  return kept;
}
