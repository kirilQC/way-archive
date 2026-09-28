// Deep search across every transcript passage.
//   1. plan:   one fast model call turns the conversation into a search plan
//              (find vs answer, rewritten query, keywords, book/speaker/date filters)
//   2. recall: hybrid pgvector + full-text search over sermon_chunks (match_sermon_chunks RPC),
//              restricted by the plan's filters, fused with reciprocal rank fusion
//   3. rerank: a model reads the top passages and keeps the ones that actually match,
//              with a one-line note on what is said at each moment
// Returns sermons with their matching timestamped moments.
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

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['find', 'answer'],
      description:
        '"find" ONLY when the user explicitly asks to be shown or pointed to sermons, messages, clips, or moments (e.g. "show me sermons about money", "give me a sermon where he talks about marriage from Matthew", "which message had the story about the coach", "find the part where"). "answer" for everything else, including "what has Way Church taught about X", "what does the Bible say about X", "how do I X", and follow-up questions about a listed sermon.',
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
      description: 'Bible books the user explicitly restricts to ("from Matthew", "in Romans"). Empty unless they asked.',
    },
    speaker: { type: 'string', description: 'Preacher name if the user restricts to one, else empty string.' },
    date_from: { type: 'string', description: 'YYYY-MM-DD lower bound if the user restricts by time, else empty string.' },
    date_to: { type: 'string', description: 'YYYY-MM-DD upper bound if the user restricts by time, else empty string.' },
    label: {
      type: 'string',
      description: 'Short lowercase label for what was found, used in a heading like "8 sermons on ___" (e.g. "marriage in Matthew").',
    },
  },
  required: ['mode', 'search_query', 'keywords', 'books', 'speaker', 'date_from', 'date_to', 'label'],
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
        content: `You plan searches over a church's sermon transcript archive (Way Church, Nashville). Today is ${today}. Plan a search for the user's LAST message (use earlier turns only to resolve follow-ups like "what about in Luke?").

Filters are hard restrictions, so be strict: set books, speaker, date_from, and date_to ONLY when the user explicitly limits the search that way ("from Matthew", "by Grant", "this year"). A general question like "what does the Bible say about X" has NO book filter. Never guess a speaker. Otherwise leave them empty.`,
      },
      { role: 'user', content: convo },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'search_plan', strict: true, schema: PLAN_SCHEMA } },
  });
  const plan = JSON.parse(res.choices[0].message.content);
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  return {
    ...plan,
    books: canonicalBooks(plan.books),
    speaker: plan.speaker.trim(),
    date_from: isDate(plan.date_from) ? plan.date_from : null,
    date_to: isDate(plan.date_to) ? plan.date_to : null,
  };
}

async function recall(plan, embedding, { useFilters = true } = {}) {
  const tsQuery = [...new Set(plan.keywords.map((k) => k.replace(/[^\w\s']/g, ' ').trim()).filter(Boolean))]
    .map((k) => (k.includes(' ') ? `"${k}"` : k))
    .join(' or ');
  const { data, error } = await db().rpc('match_sermon_chunks', {
    query_embedding: embedding,
    query_text: tsQuery,
    filter_books: useFilters && plan.books.length ? plan.books : null,
    filter_speaker: useFilters && plan.speaker ? `%${plan.speaker}%` : null,
    date_from: useFilters ? plan.date_from : null,
    date_to: useFilters ? plan.date_to : null,
    match_count: 40,
  });
  if (error) throw new Error(`match_sermon_chunks failed: ${error.message}`);
  return data || [];
}

async function rerank(plan, question, passages, sermons) {
  const res = await client().chat.completions.create({
    model: MODEL(),
    reasoning_effort: 'low',
    messages: [
      {
        role: 'system',
        content:
          'You judge search results from a sermon transcript archive. Transcripts are auto-captions, so expect typos and mis-heard names. Keep only passages that genuinely match what the user is looking for (the topic is actually discussed there, not just a word in passing, and any requested book, speaker, or angle is honored). Order best first. For each, write a note of at most 18 words saying what is said at that moment, in plain words, never with em dashes or en dashes. Return an empty list if nothing fits.',
      },
      {
        role: 'user',
        content:
          `User request: ${question}\nLooking for: ${plan.search_query}${plan.books.length ? `\nRequired book(s): ${plan.books.join(', ')}` : ''}\n\n` +
          passages
            .map((p) => {
              const s = sermons.get(p.sermon_id);
              return `[${p.chunk_id}] "${s?.title || ''}" (${s?.speaker || 'unknown'}, ${s?.date || ''}; books: ${(s?.bible_books || []).join(', ')})\n${p.text.slice(0, 1500)}`;
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
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { id: { type: 'integer' }, note: { type: 'string' } },
                required: ['id', 'note'],
              },
            },
          },
          required: ['matches'],
        },
      },
    },
  });
  return JSON.parse(res.choices[0].message.content).matches;
}

const SERMON_COLS = 'id,title,date,speaker,thumbnail,bible_books,summary';

// Returns { plan, sermons: [{ id, title, date, speaker, thumbnail, moments: [{ start_seconds, note, text }] }] }
export async function deepSearch(history, { maxSermons = 10, maxMoments = 3 } = {}) {
  const question = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  const plan = await planSearch(history);
  const [embedding] = await embedTexts([plan.search_query || question]);

  let passages = await recall(plan, embedding);
  const filtered = plan.books.length || plan.speaker || plan.date_from || plan.date_to;
  if (!passages.length && filtered) passages = await recall(plan, embedding, { useFilters: false });
  if (!passages.length) return { plan, sermons: [] };

  const ids = [...new Set(passages.map((p) => p.sermon_id))];
  const { data: rows } = await db().from('sermons').select(SERMON_COLS).in('id', ids);
  const byId = new Map((rows || []).map((s) => [s.id, s]));

  let matches;
  try {
    matches = await rerank(plan, question, passages, byId);
  } catch {
    // Reranker failed: trust the fused ranking, top passages only
    matches = passages.slice(0, 12).map((p) => ({ id: p.chunk_id, note: '' }));
  }

  const passageById = new Map(passages.map((p) => [Number(p.chunk_id), p]));
  const grouped = new Map();
  for (const m of matches) {
    const p = passageById.get(Number(m.id));
    const s = p && byId.get(p.sermon_id);
    if (!s) continue;
    if (!grouped.has(s.id)) {
      if (grouped.size >= maxSermons) continue;
      grouped.set(s.id, {
        id: s.id,
        title: s.title,
        date: s.date,
        speaker: s.speaker,
        thumbnail: s.thumbnail,
        summary: s.summary,
        moments: [],
      });
    }
    const g = grouped.get(s.id);
    // Overlapping passages can both match; keep moments at least a minute apart
    if (g.moments.length < maxMoments && g.moments.every((x) => Math.abs(x.start_seconds - p.start_seconds) > 60)) {
      g.moments.push({ start_seconds: p.start_seconds, note: noDashes(m.note), text: p.text });
    }
  }
  for (const g of grouped.values()) g.moments.sort((a, b) => a.start_seconds - b.start_seconds);
  return { plan, sermons: [...grouped.values()] };
}
