// Multi-turn scripture Q&A chat.
// System prompt adapted from Cameron Pak's open-sourced Bible Bot prompt
// (MIT No Attribution, https://gist.github.com/cameronapak/5f6353542c9683cb4967fe12a435db99).
// Verse text itself is rendered client-side from /api/passage (real NLT text),
// so the model only supplies references and is told never to fabricate quotes.
import OpenAI from 'openai';
import { db } from '../../../lib/supabase.js';
import { noDashes } from '../../../lib/text.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let openai;

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
- NEVER invent, misattribute, or paraphrase-as-quote a Bible verse. Do not write out verse quotations in your answer text at all: instead, put the references in the verse_references field and the site will display the real NLT text.
- Refer to passages naturally in prose ("Paul addresses this in Romans 8...") and cite 1-4 key references per answer in verse_references (format: "Book C:V" or "Book C:V-V", e.g. "Romans 8:28" or "Psalm 23:1-3").

Style:
- Concise: 1-3 short paragraphs. Warm, patient, non-quarrelsome, plain language.
- Never use em dashes or en dashes; use commas, periods, or colons instead.
- Stay on topic: Scripture, faith, theology, Christian living. Politely redirect unrelated questions.

Also produce sermon_search_query: 1-3 lowercase keywords for finding related sermons in this church's archive (e.g. "anxiety fear"), or "" if nothing fits.`;

export async function POST(request) {
  const { messages } = await request.json();
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }
  // Keep the conversation bounded
  const history = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000),
  }));

  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [{ role: 'system', content: SYSTEM }, ...history],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'bible_answer',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            answer: { type: 'string' },
            verse_references: { type: 'array', items: { type: 'string' } },
            sermon_search_query: { type: 'string' },
          },
          required: ['answer', 'verse_references', 'sermon_search_query'],
        },
      },
    },
  });

  const result = JSON.parse(completion.choices[0].message.content);

  // Related sermons from the archive (best effort)
  let sources = [];
  const q = result.sermon_search_query?.trim();
  if (q) {
    try {
      const { data } = await db().rpc('search_sermons', { q });
      const ids = (data || []).slice(0, 3).map((r) => r.id);
      if (ids.length) {
        const { data: sermons } = await db()
          .from('sermons')
          .select('id,title,date,speaker')
          .in('id', ids);
        sources = ids
          .map((id) => (sermons || []).find((s) => s.id === id))
          .filter(Boolean);
      }
    } catch {
      // sermon links are a bonus; never fail the answer over them
    }
  }

  return Response.json({
    answer: noDashes(result.answer),
    verses: (result.verse_references || []).slice(0, 4).map(noDashes),
    sources,
  });
}
