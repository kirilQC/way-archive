import OpenAI from 'openai';
import { db } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let openai;
const MODEL = () => process.env.OPENAI_MODEL || 'gpt-5-mini';

// Pull a transcript excerpt around the first occurrence of any search term
function excerpt(transcript, terms, radius = 1200) {
  if (!transcript) return '';
  const lower = transcript.toLowerCase();
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1) {
      return transcript.slice(Math.max(0, idx - radius), idx + radius);
    }
  }
  return transcript.slice(0, radius * 2);
}

export async function POST(request) {
  const { question } = await request.json();
  const q = question?.trim();
  if (!q || q.length < 5) return Response.json({ error: 'Ask a fuller question.' }, { status: 400 });

  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1. Turn the question into search queries
  const kw = await openai.chat.completions.create({
    model: MODEL(),
    messages: [
      {
        role: 'system',
        content:
          'Convert the user question into 2-4 short full-text search queries (1-3 words each) that would find relevant passages in church sermon transcripts. Use synonyms across queries (e.g. "dating" → also "relationships", "marriage").',
      },
      { role: 'user', content: q },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'queries',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { queries: { type: 'array', items: { type: 'string' } } },
          required: ['queries'],
        },
      },
    },
  });
  const queries = JSON.parse(kw.choices[0].message.content).queries.slice(0, 4);

  // 2. Retrieve top sermons via full-text search
  const found = new Map(); // id -> best rank
  for (const query of queries) {
    const { data } = await db().rpc('search_sermons', { q: query });
    for (const r of data || []) {
      if (!found.has(r.id) || r.rank > found.get(r.id)) found.set(r.id, r.rank);
    }
  }
  const topIds = [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  if (topIds.length === 0) {
    return Response.json({ answer: "Nothing in the archive addresses that yet.", sources: [] });
  }

  const { data: sermons } = await db()
    .from('sermons')
    .select('id,title,date,speaker,summary,transcript')
    .in('id', topIds);

  const terms = queries.flatMap((s) => s.split(/\s+/)).filter((w) => w.length > 3);
  const context = (sermons || [])
    .map(
      (s) =>
        `SERMON ${s.id}\nTitle: ${s.title}\nDate: ${s.date}\nSpeaker: ${s.speaker || 'unknown'}\nSummary: ${s.summary}\nTranscript excerpt: ${excerpt(s.transcript, terms)}`
    )
    .join('\n\n---\n\n');

  // 3. Answer from the retrieved sermons
  const completion = await openai.chat.completions.create({
    model: MODEL(),
    messages: [
      {
        role: 'system',
        content:
          "You answer questions about what Way Church (Nashville) has taught, using ONLY the provided sermon excerpts. Synthesize across sermons; mention sermon titles naturally when referencing them. If the excerpts don't address the question, say so plainly. 2-4 short paragraphs, plain text.",
      },
      { role: 'user', content: `Question: ${q}\n\nSermons:\n\n${context}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'archive_answer',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string' },
            sermon_ids_used: {
              type: 'array',
              items: { type: 'string' },
              description: 'ids of the sermons the answer actually drew from',
            },
          },
          required: ['answer', 'sermon_ids_used'],
        },
      },
    },
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const used = new Set(result.sermon_ids_used);
  const sources = (sermons || [])
    .filter((s) => used.has(s.id))
    .map(({ id, title, date, speaker }) => ({ id, title, date, speaker }));

  return Response.json({
    answer: result.answer,
    sources: sources.length ? sources : (sermons || []).map(({ id, title, date, speaker }) => ({ id, title, date, speaker })),
  });
}
