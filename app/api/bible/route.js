// Multi-turn scripture Q&A chat, streamed.
// System prompt adapted from Cameron Pak's open-sourced Bible Bot prompt
// (MIT No Attribution, https://gist.github.com/cameronapak/5f6353542c9683cb4967fe12a435db99).
// The model streams plain answer text, then a ###META### line with JSON
// { verse_references, sermon_search_query }. The server forwards the answer text
// as it arrives, then appends a ###DONE### JSON tail with verses + related sermons.
// Verse text itself is rendered client-side from /api/passage (real NLT text),
// so the model only supplies references and is told never to fabricate quotes.
import OpenAI from 'openai';
import { db } from '../../../lib/supabase.js';
import { noDashes } from '../../../lib/text.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let openai;

const META = '###META###';
const DONE = '###DONE###';

const SYSTEM = `You are the Bible guide on the Way Church (Nashville) sermon archive website. You help people understand Scripture and follow Jesus.

Identity and safety:
- You are an AI assistant, not a pastor or counselor. If asked, say so plainly.
- For crisis situations (self-harm, abuse, emergencies), gently prioritize the person's safety: urge them to contact emergency services or a crisis line, and to reach out to a trusted person and their local church. Keep the spiritual reflection brief in those cases.
- For serious personal issues (mental health, medical, legal, marriage crisis), encourage professional help and real church community alongside any biblical perspective.

Theology:
- Anchor answers in historic, orthodox Christianity. Scripture is the highest authority.
- Salvation is by grace through faith in Jesus Christ.
- Hold grace and truth together: be kind, and be biblically clear about sin and repentance. Reject prosperity gospel, cheap grace, and legalism.
- On genuinely disputed secondary matters, briefly note that faithful Christians differ.

Scripture rules:
- NEVER invent, misattribute, or paraphrase-as-quote a Bible verse. Do not write out verse quotations in your answer text at all: the site displays the real NLT text for every reference you list.
- Refer to passages naturally in prose ("Paul addresses this in Romans 8...").

Style:
- Concise: 1-3 short paragraphs. Warm, patient, non-quarrelsome, plain language.
- Never use em dashes or en dashes; use commas, periods, or colons instead.
- Stay on topic: Scripture, faith, theology, Christian living. Politely redirect unrelated questions.

OUTPUT FORMAT (exactly):
1. Your answer as plain text.
2. Then a new line containing exactly ${META}
3. Then one line of JSON: {"verse_references": ["Book C:V" or "Book C:V-V", 1-4 items], "sermon_search_query": "1-3 lowercase keywords for finding related sermons in this church's archive, or empty string"}`;

async function relatedSermons(q) {
  if (!q?.trim()) return [];
  try {
    const { data } = await db().rpc('search_sermons', { q: q.trim() });
    const ids = (data || []).slice(0, 3).map((r) => r.id);
    if (!ids.length) return [];
    const { data: sermons } = await db()
      .from('sermons')
      .select('id,title,date,speaker')
      .in('id', ids);
    return ids.map((id) => (sermons || []).find((s) => s.id === id)).filter(Boolean);
  } catch {
    return []; // sermon links are a bonus; never fail the answer over them
  }
}

export async function POST(request) {
  const { messages } = await request.json();
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }
  const history = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000),
  }));

  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const stream = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [{ role: 'system', content: SYSTEM }, ...history],
    stream: true,
    reasoning_effort: 'low', // chat UX: fast first token matters more than deep reasoning
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let full = '';
      let pending = ''; // held-back tail in case the META delimiter spans chunks
      let metaSeen = false;
      try {
        for await (const part of stream) {
          const delta = part.choices?.[0]?.delta?.content || '';
          if (!delta || metaSeen) {
            full += delta;
            continue;
          }
          full += delta;
          pending += delta;
          const idx = pending.indexOf(META);
          if (idx !== -1) {
            const text = pending.slice(0, idx).trimEnd();
            if (text) controller.enqueue(encoder.encode(noDashes(text)));
            metaSeen = true;
            pending = '';
          } else if (pending.length > META.length) {
            const emit = pending.slice(0, pending.length - META.length);
            pending = pending.slice(pending.length - META.length);
            controller.enqueue(encoder.encode(noDashes(emit)));
          }
        }
        if (!metaSeen && pending) controller.enqueue(encoder.encode(noDashes(pending)));

        // Parse the meta tail
        let verses = [];
        let query = '';
        const mIdx = full.indexOf(META);
        if (mIdx !== -1) {
          try {
            const meta = JSON.parse(full.slice(mIdx + META.length).trim());
            verses = [...new Set((meta.verse_references || []).map((v) => noDashes(String(v).trim())))].slice(0, 4);
            query = String(meta.sermon_search_query || '');
          } catch {
            // meta malformed: answer already streamed, just skip extras
          }
        }
        const sources = await relatedSermons(query);
        controller.enqueue(encoder.encode('\n' + DONE + JSON.stringify({ verses, sources })));
      } catch {
        controller.enqueue(encoder.encode('\n' + DONE + JSON.stringify({ verses: [], sources: [] })));
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
