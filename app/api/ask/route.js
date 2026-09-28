// Unified Ask: multi-turn chat over the Bible and everything Way Church has preached.
// System prompt guardrails adapted from Cameron Pak's open-sourced Bible Bot prompt
// (MIT No Attribution, https://gist.github.com/cameronapak/5f6353542c9683cb4967fe12a435db99).
//
// Every request is planned first (lib/deepsearch.js planSearch), then handled by mode:
//   find     sermons + exact timestamped moments with verbatim quotes, no prose
//   clips    ready-to-post clips (start/end, verbatim transcript, hook, caption)
//   verse    every sermon where a reference was said aloud (lib/verseindex.js), no AI ranking
//   answer   prose written from numbered transcript citations [n]
//   compare  like answer, wider retrieval, chronological, laid out side by side / as a timeline
//   guide    builds a resource (small group guide, study plan) from the citations
//
// Wire format: prose modes stream answer text, then the server appends ###DONE### + JSON tail
// { mode, verses, citations, sources }. Non-prose modes return ###DONE### + JSON immediately.
// The model streams text, then ###META### + { verse_references }; verse text itself is rendered
// client-side from /api/passage, so the model never writes Bible quotations.
import OpenAI from 'openai';
import { after } from 'next/server';
import { db } from '../../../lib/supabase.js';
import { noDashes } from '../../../lib/text.js';
import { planSearch, deepSearch, findClips, SHAPES } from '../../../lib/deepsearch.js';
import { verseSearch } from '../../../lib/verseindex.js';
import { formatRef } from '../../../lib/verses.js';
import { logAsk } from '../../../lib/asklog.js';
import { requestInfo, VISITOR_COOKIE, SESSION_COOKIE } from '../../../lib/track.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let openai;

const META = '###META###';
const DONE = '###DONE###';

const SYSTEM = `You are the guide on the Way Church (Nashville) sermon archive website. You answer two kinds of questions, often blended: questions about the Bible, and questions about what Way Church has taught.

Identity and safety:
- You are an AI assistant, not a pastor or counselor. Only say so if directly asked; never open an answer with a disclaimer about being an AI.
- For crisis situations (self-harm, abuse, emergencies), gently prioritize the person's safety: urge them to contact emergency services or a crisis line, and to reach out to a trusted person and their local church. Keep the spiritual reflection brief in those cases.
- For serious personal issues (mental health, medical, legal, marriage crisis), encourage professional help and real church community alongside any biblical perspective.

Theology:
- Anchor answers in historic, orthodox Christianity. Scripture is the highest authority.
- Salvation is by grace through faith in Jesus Christ.
- Hold grace and truth together: be kind, and be biblically clear about sin and repentance. Reject prosperity gospel, cheap grace, and legalism.
- On genuinely disputed secondary matters, briefly note that faithful Christians differ.

Way Church sermons and citations:
- You may be given numbered sources [1], [2], ... : exact quotes from Way Church sermon transcripts (auto-captions, so expect typos), each with sermon title, preacher, date, and timestamp.
- Every statement about what Way Church or a preacher taught MUST be supported by a source and cite it right after the claim, like "Noah Herrin calls worry a trust issue [2]." Cite multiple as [1][3]. Never cite a source for something it does not say. Never invent sermon content.
- Mention sermon titles naturally when helpful. If no source addresses the question, answer from Scripture alone and do not cite.

Scripture rules:
- NEVER invent, misattribute, or paraphrase-as-quote a Bible verse. Do not write out verse quotations in your answer text at all: the site displays the real NLT text for every reference you list.
- Refer to passages naturally in prose ("Paul addresses this in Romans 8...").

Style:
- Warm, patient, non-quarrelsome, plain language.
- Never use em dashes or en dashes; use commas, periods, or colons instead.
- Formatting: plain paragraphs. You may use "## " headings and "- " bullet lines when the MODE asks for structure. No other markdown except **bold**.
- Stay on topic: Scripture, faith, theology, Christian living, this church's teaching. Politely redirect unrelated questions.

OUTPUT FORMAT (exactly):
1. Your answer as plain text.
2. Then a new line containing exactly ${META}
3. Then one line of JSON: {"verse_references": ["Book C:V" or "Book C:V-V", 0-4 items]}`;

const MODE_BRIEF = {
  answer: 'MODE: answer. Concise: 1-3 short paragraphs, no headings.',
  compare:
    'MODE: compare. The sources are in chronological order. Lay out the comparison with "## " headings: one per preacher when comparing preachers, or one per period when tracing change over time. Under each, 2-4 "- " bullets with citations. End with a short "## Takeaway" paragraph naming what is consistent and what shifted. Be honest when the sources show no real change.',
  guide:
    'MODE: guide. Build the resource the user asked for (default: a 4-week small group guide). For each part use a "## Week N: Title" heading (or the unit they asked for), then bullets for: Big idea, Scripture (references only), Watch (cite the source whose clip to play, with its sermon title), Discuss (3 questions), and Practice (one action). Ground every part in the sources and cite them. Open with one sentence naming the sermons used.',
};

async function searchSermons(q, limit) {
  if (!q?.trim()) return [];
  try {
    const { data } = await db().rpc('search_sermons', { q: q.trim() });
    return (data || []).slice(0, limit).map((r) => r.id);
  } catch {
    return [];
  }
}

async function sermonsByIds(ids, cols) {
  if (!ids.length) return [];
  const { data } = await db().from('sermons').select(cols).in('id', ids);
  return ids.map((id) => (data || []).find((s) => s.id === id)).filter(Boolean);
}

const textHeaders = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' };
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const cardOf = ({ id, title, date, speaker, thumbnail, moments }) => ({
  id,
  title,
  date,
  speaker,
  thumbnail,
  moments: (moments || []).map(({ start_seconds, note, quote }) => ({ start_seconds, note, quote })),
});

// Numbered citations from deep results: one per moment, in sermon order
function buildCitations(sermons, max) {
  const out = [];
  for (const s of sermons) {
    for (const m of s.moments) {
      if (out.length >= max) break;
      out.push({
        n: out.length + 1,
        sermon_id: s.id,
        title: s.title,
        speaker: s.speaker,
        date: s.date,
        thumbnail: s.thumbnail,
        start_seconds: m.start_seconds,
        quote: m.quote,
        context: m.text,
      });
    }
  }
  return out;
}

export async function POST(request) {
  const started = Date.now();
  const { messages } = await request.json();
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }
  const history = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000),
  }));
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content || '';
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const info = requestInfo(request);
  const who = {
    visitor_id: request.cookies.get(VISITOR_COOKIE)?.value || null,
    session_id: request.cookies.get(SESSION_COOKIE)?.value || null,
    ip: info.ip,
    city: info.city,
    region: info.region,
    country: info.country,
    device: [info.device_vendor, info.device_model, info.os, info.browser].filter(Boolean).join(' · ') || null,
  };
  const log = (entry) => after(() => logAsk({ question: lastUser, latencyMs: Date.now() - started, who, ...entry }));

  let plan = null;
  try {
    plan = await planSearch(history);
  } catch (err) {
    console.error('plan failed:', err.message);
  }

  // Verse index: exact list of every sermon where the reference was said aloud
  if (plan?.mode === 'verse' && plan.verse) {
    try {
      const sermons = await verseSearch(plan.verse);
      const label = `${formatRef(plan.verse)}`;
      log({ mode: 'verse', plan, resultCount: sermons.length, topIds: sermons.map((s) => s.id) });
      return new Response(
        DONE + JSON.stringify({ mode: 'list', kind: 'verse', topic: label, verses: [label], sources: sermons.map(cardOf) }),
        { headers: textHeaders }
      );
    } catch (err) {
      console.error('verse search failed, using deep search:', err.message);
      plan = { ...plan, mode: 'find', books: [plan.verse.book] };
    }
  }

  if (plan?.mode === 'clips') {
    try {
      const { clips } = await findClips(history, { plan });
      log({ mode: 'clips', plan, resultCount: clips.length, topIds: clips.map((c) => c.sermon_id) });
      return new Response(DONE + JSON.stringify({ mode: 'clips', topic: noDashes(plan.label), clips }), { headers: textHeaders });
    } catch (err) {
      console.error('clip search failed:', err.message);
      plan = { ...plan, mode: 'find' };
    }
  }

  const mode = plan ? (plan.mode === 'verse' ? 'find' : plan.mode) : 'answer';
  const shape = SHAPES[mode];

  let deep = null;
  if (plan) {
    try {
      deep = await deepSearch(history, { plan, ...shape });
    } catch (err) {
      console.error('deep search failed, using legacy retrieval:', err.message);
    }
  }

  // Find mode: no written answer, just the matching sermons and moments
  if (deep && mode === 'find') {
    log({ mode, plan, resultCount: deep.sermons.length, topIds: deep.sermons.map((s) => s.id) });
    const body = { mode: 'list', topic: noDashes(plan.label), verses: [], sources: deep.sermons.map(cardOf) };
    return new Response(DONE + JSON.stringify(body), { headers: textHeaders });
  }

  // Prose modes: the model writes from numbered transcript citations
  const citations = deep ? buildCitations(deep.sermons, { answer: 8, compare: 16, guide: 18 }[mode] || 8) : [];
  let contextMsg = [];
  let legacyIds = [];
  if (citations.length) {
    contextMsg = [
      {
        role: 'system',
        content:
          'Sources (exact transcript quotes, with surrounding context):\n\n' +
          citations
            .map(
              (c) =>
                `[${c.n}] "${c.title}" (${c.speaker || 'unknown'}, ${c.date}, at ${clock(c.start_seconds)})\nQuote: "${c.quote}"\nContext: ${String(c.context || '').slice(0, 900)}`
            )
            .join('\n\n'),
      },
    ];
  } else if (!deep) {
    legacyIds = await searchSermons(lastUser, 4);
    const contextSermons = await sermonsByIds(legacyIds, 'id,title,date,speaker,summary');
    if (contextSermons.length) {
      contextMsg = [
        {
          role: 'system',
          content:
            'Possibly relevant Way Church sermons (summaries only, do not use [n] citations):\n\n' +
            contextSermons
              .map((s) => `"${s.title}" (${s.speaker || 'unknown'}, ${s.date}): ${String(s.summary || '').slice(0, 400)}`)
              .join('\n\n'),
        },
      ];
    }
  }

  const stream = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [{ role: 'system', content: `${SYSTEM}\n\n${MODE_BRIEF[mode] || MODE_BRIEF.answer}` }, ...contextMsg, ...history],
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

        let verses = [];
        const mIdx = full.indexOf(META);
        if (mIdx !== -1) {
          try {
            const meta = JSON.parse(full.slice(mIdx + META.length).trim());
            verses = [...new Set((meta.verse_references || []).map((v) => noDashes(String(v).trim())))].slice(0, 4);
          } catch {
            // meta malformed: answer already streamed, just skip extras
          }
        }
        const sources = deep
          ? deep.sermons.slice(0, 6).map(cardOf)
          : await sermonsByIds(legacyIds.slice(0, 3), 'id,title,date,speaker,thumbnail');
        const tail = {
          mode,
          verses,
          citations: citations.map(({ context, ...c }) => c),
          sources,
        };
        controller.enqueue(encoder.encode('\n' + DONE + JSON.stringify(tail)));
        // Client already has everything; log before closing (after() is not reliable in here)
        await logAsk({ question: lastUser, latencyMs: Date.now() - started, who, mode, plan, resultCount: sources.length, topIds: sources.map((s) => s.id) });
      } catch (err) {
        controller.enqueue(encoder.encode('\n' + DONE + JSON.stringify({ mode, verses: [], citations: [], sources: [] })));
        await logAsk({ question: lastUser, latencyMs: Date.now() - started, who, mode, plan, resultCount: 0, error: err.message });
      }
      controller.close();
    },
  });

  return new Response(readable, { headers: textHeaders });
}
