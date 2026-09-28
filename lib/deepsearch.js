// Deep search across every transcript passage.
//   1. plan:   one fast model call turns the conversation into a search plan
//              (mode, rewritten query, keywords, book/speaker/date filters, verse, count)
//   2. recall: hybrid pgvector + full-text search over sermon_chunks (match_sermon_chunks RPC),
//              restricted by the plan's filters, fused with reciprocal rank fusion
//   3. rerank: a model reads the top passages as timestamped lines and keeps the ones that
//              actually match, pinpointing the exact span (a key statement, or a whole clip)
//   4. snap:   spans are snapped to real caption segments and the quote is cut verbatim from
//              the transcript, so quotes and timestamps never come from the model's memory
import OpenAI from 'openai';
import { db } from './supabase.js';
import { BOOKS, canonicalBooks } from './books.js';
import { embedTexts } from './chunks.js';
import { noDashes } from './text.js';

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-5-mini';
let openai;
function client() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 3 });
  return openai;
}

export const MODES = ['find', 'clips', 'verse', 'answer', 'compare', 'guide'];

// Retrieval shape per mode (shared by the Ask route and scripts/eval-ask.mjs)
export const SHAPES = {
  find: { maxSermons: 10, maxMoments: 3, matchCount: 40 },
  answer: { maxSermons: 5, maxMoments: 2, matchCount: 40 },
  compare: { maxSermons: 12, maxMoments: 2, matchCount: 60, sortByDate: true },
  guide: { maxSermons: 8, maxMoments: 3, matchCount: 60 },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: MODES,
      description: [
        '"clips": wants video clips to post or reuse as content, signalled by words like clip, reel, short, TikTok, post, content, social. Asking for "a moment where he talks about X" or "the part where" is "find", not clips.',
        '"verse": names one specific Bible reference with at least a chapter and asks where or when it was preached ("every time Romans 8:28 was preached", "sermons on John 3:16", "where did they preach Psalm 23"). If no chapter-level reference is named (e.g. "the verse the church is named after"), it is "find".',
        '"find": explicitly asks to be shown or pointed to sermons, messages, or moments ("show me sermons about money", "give me a sermon where he talks about marriage from Matthew", "which message had the story about the coach", "find the part where").',
        '"compare": asks how teaching differs between preachers, or how it changed or developed over time ("compare Grant and Noah on anxiety", "how has the teaching on money changed since 2023").',
        '"guide": asks to build a resource from sermons (small group guide, study plan, curriculum, series outline, devotional, discussion guide).',
        '"answer": everything else, including "what has Way Church taught about X", "what does the Bible say about X", "how do I X", and follow-up questions about a listed sermon.',
      ].join(' '),
    },
    search_query: {
      type: 'string',
      description: 'A standalone description of the content being looked for, written the way a preacher might actually say it, resolving follow-ups from earlier turns. Exclude filter words like book names used only as a filter, speaker names, and dates.',
    },
    keywords: {
      type: 'array',
      items: { type: 'string' },
      description: '2-8 single words or short phrases likely to be spoken in a matching passage, including synonyms (e.g. marriage, spouse, husband, wife, divorce).',
    },
    books: {
      type: 'array',
      items: { type: 'string', enum: BOOKS },
      description: 'Bible books the user explicitly restricts to ("from Matthew", "in Romans"). Empty unless they asked. For "verse" mode leave empty (use verse instead).',
    },
    speaker: { type: 'string', description: 'Preacher name if the user restricts to one, else empty string. For "compare" between preachers leave empty and name them in search_query.' },
    date_from: { type: 'string', description: 'YYYY-MM-DD lower bound if the user restricts by time, else empty string.' },
    date_to: { type: 'string', description: 'YYYY-MM-DD upper bound if the user restricts by time, else empty string.' },
    verse: {
      type: 'object',
      additionalProperties: false,
      description: 'For "verse" mode: the reference. Otherwise book "" and zeros.',
      properties: {
        book: { type: 'string', description: 'Canonical book name, e.g. "Romans", "1 John", "Psalms", or empty string.' },
        chapter: { type: 'integer' },
        verse_start: { type: 'integer', description: '0 if the whole chapter' },
        verse_end: { type: 'integer', description: '0 unless a range' },
      },
      required: ['book', 'chapter', 'verse_start', 'verse_end'],
    },
    count: { type: 'integer', description: 'How many clips or results the user asked for, or 0 if unspecified.' },
    label: {
      type: 'string',
      description: 'Short lowercase label naming only the subject, used in headings like "8 sermons on ___" or "5 clips on ___" (e.g. "marriage in Matthew", "anxiety"). Never include words like sermons, clips, reels, or content.',
    },
  },
  required: ['mode', 'search_query', 'keywords', 'books', 'speaker', 'date_from', 'date_to', 'verse', 'count', 'label'],
};

export async function planSearch(history) {
  const today = new Date().toISOString().slice(0, 10);
  const convo = history
    .slice(-6)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${String(m.content).slice(0, 600)}`)
    .join('\n');
  const res = await client().chat.completions.create({
    model: MODEL(),
    reasoning_effort: 'minimal',
    messages: [
      {
        role: 'system',
        content: `You plan searches over a church's sermon transcript archive (Way Church, Nashville). Today is ${today}. Plan a search for the user's LAST message (use earlier turns only to resolve follow-ups like "what about in Luke?" or "only Grant").

Filters are hard restrictions, so be strict: set books, speaker, date_from, and date_to ONLY when the user explicitly limits the search that way ("from Matthew", "by Grant", "this year"). A general question like "what does the Bible say about X" has NO book filter. Never guess a speaker. Otherwise leave them empty.`,
      },
      { role: 'user', content: convo },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'search_plan', strict: true, schema: PLAN_SCHEMA } },
  });
  const plan = JSON.parse(res.choices[0].message.content);
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const vBook = canonicalBooks([plan.verse?.book])[0] || null;
  return {
    ...plan,
    // Verse mode needs a real reference; "the verse the church is named after" is a search
    mode: plan.mode === 'verse' && !(vBook && plan.verse.chapter > 0) ? 'find' : plan.mode,
    books: canonicalBooks(plan.books),
    speaker: plan.speaker.trim(),
    date_from: isDate(plan.date_from) ? plan.date_from : null,
    date_to: isDate(plan.date_to) ? plan.date_to : null,
    verse:
      vBook && plan.verse.chapter > 0
        ? {
            book: vBook,
            chapter: plan.verse.chapter,
            verse_start: plan.verse.verse_start || null,
            verse_end: plan.verse.verse_end > plan.verse.verse_start ? plan.verse.verse_end : null,
          }
        : null,
    count: Math.max(0, Math.min(12, plan.count || 0)),
  };
}

async function recall(plan, embedding, { useFilters = true, matchCount = 40 } = {}) {
  const tsQuery = [...new Set(plan.keywords.map((k) => k.replace(/[^\w\s']/g, ' ').trim()).filter(Boolean))]
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' or ');
  const args = {
    query_embedding: embedding,
    query_text: tsQuery,
    filter_books: useFilters && plan.books.length ? plan.books : null,
    filter_speaker: useFilters && plan.speaker ? `%${plan.speaker}%` : null,
    date_from: useFilters ? plan.date_from : null,
    date_to: useFilters ? plan.date_to : null,
    match_count: matchCount,
  };
  let { data, error } = await db().rpc('match_sermon_chunks', args);
  // A cold cache can push the first scan past the statement timeout; the retry hits a warm one
  if (error?.message?.includes('statement timeout')) ({ data, error } = await db().rpc('match_sermon_chunks', args));
  if (error) throw new Error(`match_sermon_chunks failed: ${error.message}`);
  return data || [];
}

// Caption segments for each passage: stored on the chunk when available, otherwise sliced
// from the sermon's full segment list.
async function loadSegments(passages) {
  const ids = passages.map((p) => p.chunk_id);
  const { data, error } = await db().from('sermon_chunks').select('id,segments').in('id', ids);
  const out = new Map();
  if (!error) for (const r of data || []) if (Array.isArray(r.segments)) out.set(Number(r.id), r.segments);
  const missing = passages.filter((p) => !out.has(Number(p.chunk_id)));
  if (missing.length) {
    const sermonIds = [...new Set(missing.map((p) => p.sermon_id))];
    const { data: rows } = await db().from('sermons').select('id,transcript_segments').in('id', sermonIds);
    const bySermon = new Map((rows || []).map((r) => [r.id, r.transcript_segments || []]));
    for (const p of missing) {
      const segs = (bySermon.get(p.sermon_id) || []).filter((s) => s.start >= p.start_seconds && s.start < p.end_seconds);
      out.set(Number(p.chunk_id), segs);
    }
  }
  return out;
}

const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const parseClock = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v || '').match(/^(\d+):(\d{1,2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// ~8 second lines so the model can point at precise moments without drowning in segments
function timedLines(segs) {
  const lines = [];
  let cur = null;
  for (const s of segs) {
    if (!cur || s.start - cur.start >= 8) {
      cur = { start: s.start, text: s.text };
      lines.push(cur);
    } else cur.text += ' ' + s.text;
  }
  return lines.map((l) => `[${clock(l.start)}] ${l.text.replace(/\s+/g, ' ').trim()}`).join('\n');
}

// Snap a model-chosen span to real segments inside the passage and cut the verbatim text
function snapSpan(segs, startGuess, endGuess, { minLen, maxLen, passageEnd }) {
  if (!segs.length) return null;
  let a = Number.isFinite(startGuess) ? startGuess : segs[0].start;
  let startIdx = 0;
  for (let i = 0; i < segs.length; i++) if (segs[i].start <= a + 1) startIdx = i;
  const start = segs[startIdx].start;
  let b = Number.isFinite(endGuess) && endGuess > start ? endGuess : start + minLen;
  b = Math.min(Math.max(b, start + minLen), start + maxLen);
  let endIdx = startIdx;
  while (endIdx + 1 < segs.length && segs[endIdx + 1].start < b) endIdx++;
  const end = Math.min(segs[endIdx + 1]?.start ?? segs[endIdx].start + 4, passageEnd ?? Infinity);
  const text = noDashes(
    segs
      .slice(startIdx, endIdx + 1)
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  return { start_seconds: Math.floor(start), end_seconds: Math.ceil(Math.max(end, start + 2)), text };
}

const RERANK_SYSTEM = {
  moments:
    'You judge search results from a sermon transcript archive. Transcripts are auto-captions, so expect typos and mis-heard names. Keep only passages that genuinely match what the user is looking for (the topic is actually discussed there, not just a word in passing, and any requested book, speaker, or angle is honored). Order best first. For each, give start and end as m:ss from the line markers, spanning the single most relevant statement (usually 8-40 seconds), and a note of at most 18 words saying what is said there. Never use em dashes or en dashes. Return an empty list if nothing fits.',
  clips:
    'You pick short-form video clips (Reels, Shorts, TikTok) from sermon transcripts. Transcripts are auto-captions, so expect typos. Keep only passages that contain a strong, self-contained clip on what the user wants. For each clip give start and end as m:ss from the line markers: start at the beginning of a complete thought (never mid-sentence or mid-story), end at a natural stopping point, 30-90 seconds long. A viewer with no context must understand it. Also write a hook (on-screen opening text, at most 10 words, punchy, faithful to what is said) and a caption (1-2 sentences for the post, no hashtags). Return up to 3 more clips than requested when available, best first. Never use em dashes or en dashes. Return an empty list if nothing is clip-worthy.',
};

async function rerank(kind, plan, question, passages, sermons, segsById) {
  const item =
    kind === 'clips'
      ? { id: { type: 'integer', description: 'The N from [PN]' }, start: { type: 'string' }, end: { type: 'string' }, hook: { type: 'string' }, caption: { type: 'string' } }
      : { id: { type: 'integer', description: 'The N from [PN]' }, start: { type: 'string' }, end: { type: 'string' }, note: { type: 'string' } };
  const res = await client().chat.completions.create({
    model: MODEL(),
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: RERANK_SYSTEM[kind] },
      {
        role: 'user',
        content:
          `User request: ${question}\nLooking for: ${plan.search_query}${plan.books.length ? `\nRequired book(s): ${plan.books.join(', ')}` : ''}${kind === 'clips' ? `\nClips wanted: ${plan.count || 6}` : ''}\n\n` +
          passages
            .map((p, i) => {
              const s = sermons.get(p.sermon_id);
              const segs = segsById.get(Number(p.chunk_id)) || [];
              return `[P${i + 1}] "${s?.title || ''}" (${s?.speaker || 'unknown'}, ${s?.date || ''}; books: ${(s?.bible_books || []).join(', ')})\n${segs.length ? timedLines(segs) : `[${clock(p.start_seconds)}] ${p.text}`}`;
            })
            .join('\n\n'),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'reranked',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: {
              type: 'array',
              items: { type: 'object', additionalProperties: false, properties: item, required: Object.keys(item) },
            },
          },
          required: ['matches'],
        },
      },
    },
  });
  // Model answers with the P number it was shown; map back to chunk ids
  return JSON.parse(res.choices[0].message.content)
    .matches.map((m) => ({ ...m, id: passages[m.id - 1]?.chunk_id }))
    .filter((m) => m.id != null);
}

const SERMON_COLS = 'id,youtube_id,title,date,speaker,thumbnail,bible_books,summary';

async function retrieve(plan, question, { matchCount }) {
  const [embedding] = await embedTexts([plan.search_query || question]);
  let passages = await recall(plan, embedding, { matchCount });
  const filtered = plan.books.length || plan.speaker || plan.date_from || plan.date_to;
  if (!passages.length && filtered) passages = await recall(plan, embedding, { useFilters: false, matchCount });
  if (!passages.length) return null;
  const ids = [...new Set(passages.map((p) => p.sermon_id))];
  const [{ data: rows }, segsById] = await Promise.all([
    db().from('sermons').select(SERMON_COLS).in('id', ids),
    loadSegments(passages),
  ]);
  return { passages, byId: new Map((rows || []).map((s) => [s.id, s])), segsById };
}

const lastUser = (history) => [...history].reverse().find((m) => m.role === 'user')?.content || '';

// Returns { plan, sermons: [{ id, youtube_id, title, date, speaker, thumbnail, moments:
//   [{ start_seconds, end_seconds, note, quote, text }] }] }
export async function deepSearch(history, { plan, maxSermons = 10, maxMoments = 3, matchCount = 40, sortByDate = false } = {}) {
  const question = lastUser(history);
  plan = plan || (await planSearch(history));
  const found = await retrieve(plan, question, { matchCount });
  if (!found) return { plan, sermons: [] };
  const { passages, byId, segsById } = found;

  let matches;
  try {
    matches = await rerank('moments', plan, question, passages, byId, segsById);
  } catch {
    // Reranker failed: trust the fused ranking, top passages only
    matches = passages.slice(0, 12).map((p) => ({ id: p.chunk_id, start: '', end: '', note: '' }));
  }

  const passageById = new Map(passages.map((p) => [Number(p.chunk_id), p]));
  const grouped = new Map();
  for (const m of matches) {
    const p = passageById.get(Number(m.id));
    const s = p && byId.get(p.sermon_id);
    if (!s) continue;
    if (!grouped.has(s.id)) {
      if (grouped.size >= maxSermons) continue;
      const { id, youtube_id, title, date, speaker, thumbnail, summary } = s;
      grouped.set(s.id, { id, youtube_id, title, date, speaker, thumbnail, summary, moments: [] });
    }
    const g = grouped.get(s.id);
    const segs = segsById.get(Number(p.chunk_id)) || [];
    const span = snapSpan(segs, parseClock(m.start), parseClock(m.end), { minLen: 6, maxLen: 45, passageEnd: p.end_seconds }) || {
      start_seconds: p.start_seconds,
      end_seconds: p.end_seconds,
      text: p.text.slice(0, 300),
    };
    // Overlapping passages can both match; keep moments at least 45 seconds apart
    if (g.moments.length < maxMoments && g.moments.every((x) => Math.abs(x.start_seconds - span.start_seconds) > 45)) {
      g.moments.push({
        start_seconds: span.start_seconds,
        end_seconds: span.end_seconds,
        note: noDashes(m.note || ''),
        quote: span.text,
        text: p.text,
      });
    }
  }
  const sermons = [...grouped.values()];
  for (const g of sermons) g.moments.sort((a, b) => a.start_seconds - b.start_seconds);
  if (sortByDate) sermons.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { plan, sermons };
}

// Returns { plan, clips: [{ sermon_id, youtube_id, title, speaker, date, thumbnail,
//   start_seconds, end_seconds, hook, caption, transcript }] }
export async function findClips(history, { plan } = {}) {
  const question = lastUser(history);
  plan = plan || (await planSearch(history));
  const want = plan.count || 6;
  const found = await retrieve(plan, question, { matchCount: 40 });
  if (!found) return { plan, clips: [] };
  const { passages, byId, segsById } = found;
  const matches = await rerank('clips', plan, question, passages, byId, segsById);
  const passageById = new Map(passages.map((p) => [Number(p.chunk_id), p]));
  // Clips may run past a passage's 2 minute window, so snap against the whole sermon
  const chosen = [...new Set(matches.map((m) => passageById.get(Number(m.id))?.sermon_id).filter(Boolean))];
  const { data: full } = await db().from('sermons').select('id,transcript_segments').in('id', chosen);
  const fullSegs = new Map((full || []).map((r) => [r.id, r.transcript_segments || []]));
  const clips = [];
  const perSermon = new Map();
  for (const m of matches) {
    if (clips.length >= want) break;
    const p = passageById.get(Number(m.id));
    const s = p && byId.get(p.sermon_id);
    if (!s || (perSermon.get(s.id) || 0) >= 2) continue;
    const segs = fullSegs.get(s.id) || segsById.get(Number(p.chunk_id)) || [];
    const span = snapSpan(segs, parseClock(m.start), parseClock(m.end), { minLen: 20, maxLen: 100 });
    if (!span || span.end_seconds - span.start_seconds < 20) continue;
    if (clips.some((c) => c.sermon_id === s.id && Math.abs(c.start_seconds - span.start_seconds) < 60)) continue;
    perSermon.set(s.id, (perSermon.get(s.id) || 0) + 1);
    clips.push({
      sermon_id: s.id,
      youtube_id: s.youtube_id,
      title: s.title,
      speaker: s.speaker,
      date: s.date,
      thumbnail: s.thumbnail,
      start_seconds: span.start_seconds,
      end_seconds: span.end_seconds,
      hook: noDashes(m.hook || ''),
      caption: noDashes(m.caption || ''),
      transcript: span.text,
    });
  }
  return { plan, clips };
}
