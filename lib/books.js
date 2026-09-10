// The 66 books in canonical order. Index + 1 = bolls.life book id.
export const BOOKS = [
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

export const NT_START = 39; // index of Matthew

const ALIASES = {
  Psalm: 'Psalms',
  'Song of Songs': 'Song of Solomon',
  Canticles: 'Song of Solomon',
  Revelations: 'Revelation',
};

// Normalize a model-produced book name to the canonical list, or null if unrecognizable.
export function canonicalBook(name) {
  const n = String(name || '').replace(/\s*\(.*\)\s*$/, '').trim();
  return BOOKS.includes(n) ? n : ALIASES[n] || null;
}

export function canonicalBooks(list) {
  return [...new Set((list || []).map(canonicalBook).filter(Boolean))];
}
