// Weekly clip packs: one model pass reads a whole timestamped sermon and proposes 8-10
// short-form clips across a deliberate mix of types, so the content team gets variety rather
// than ten versions of the same point. Spans are snapped to real caption segments and the
// transcript is cut verbatim (same guarantees as Ask). Stored in sermon_clips (kind 'auto').
import OpenAI from 'openai';
import { db } from './supabase.js';
import { noDashes } from './text.js';
import { timedLines, snapSpan, parseClock } from './deepsearch.js';

export const CLIP_TYPES = {
  hook: 'Hook',
  story: 'Story',
  quote: 'Quotable',
  scripture: 'Scripture',
  practical: 'Practical',
  gospel: 'Gospel',
};

let openai;
function client() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 4 });
  return openai;
}

const SYSTEM = `You are the social media producer for Way Church (Nashville). From one sermon transcript (auto-captions, expect typos), pick 8 to 10 clips for Reels, Shorts, and TikTok.

Every clip must:
- start at the beginning of a complete thought (never mid-sentence or mid-story) and end at a natural stopping point
- be 25 to 90 seconds long, and make sense to a viewer with zero context
- be faithful to what is actually said

Deliberately mix these types, at least one of each when the sermon has it:
- hook: a punchy, provocative opening line or question that stops the scroll
- story: a personal story or illustration with a payoff
- quote: one memorable, quotable statement (can be short, 25-40s)
- scripture: the preacher reading or unpacking a key verse
- practical: a concrete "here is what to do" moment
- gospel: a clear moment about Jesus, grace, or an invitation to faith

For each clip give start and end as m:ss taken from the [m:ss] line markers, the type, a hook (on-screen opening text, at most 10 words, punchy, faithful), and a caption (1-2 sentences for the post, no hashtags). No two clips may overlap. Order them by how strong they are, best first. Never use em dashes or en dashes.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: Object.keys(CLIP_TYPES) },
          start: { type: 'string' },
          end: { type: 'string' },
          hook: { type: 'string' },
          caption: { type: 'string' },
        },
        required: ['type', 'start', 'end', 'hook', 'caption'],
      },
    },
  },
  required: ['clips'],
};

const overlap = (a, b) => Math.max(0, Math.min(a.end_seconds, b.end_seconds) - Math.max(a.start_seconds, b.start_seconds));

// sermon: { id, title, speaker, transcript_segments } -> clips (not saved)
export async function generateClipPack(sermon) {
  const segs = sermon.transcript_segments || [];
  if (segs.length < 20) return [];
  const res = await client().chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Sermon: "${sermon.title}"${sermon.speaker ? ` by ${sermon.speaker}` : ''}\n\n${timedLines(segs)}`,
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'clip_pack', strict: true, schema: SCHEMA } },
  });
  const proposed = JSON.parse(res.choices[0].message.content).clips;
  const out = [];
  for (const c of proposed) {
    const span = snapSpan(segs, parseClock(c.start), parseClock(c.end), { minLen: 20, maxLen: 105, sentences: true });
    if (!span || span.end_seconds - span.start_seconds < 20) continue;
    // Drop clips that mostly repeat one already kept
    if (out.some((k) => overlap(k, span) > 0.4 * (span.end_seconds - span.start_seconds))) continue;
    out.push({
      sermon_id: sermon.id,
      kind: 'auto',
      clip_type: c.type,
      start_seconds: span.start_seconds,
      end_seconds: span.end_seconds,
      hook: noDashes(c.hook),
      caption: noDashes(c.caption),
      transcript: span.text,
      rank: out.length + 1,
    });
  }
  return out;
}

// Replaces a sermon's auto clips (custom clips are never touched).
export async function saveClipPack(sermonId, clips) {
  const supabase = db();
  const { error: delErr } = await supabase.from('sermon_clips').delete().eq('sermon_id', sermonId).eq('kind', 'auto');
  if (delErr) throw new Error(`clip delete failed: ${delErr.message}`);
  if (!clips.length) return 0;
  const { error } = await supabase.from('sermon_clips').insert(clips);
  if (error) throw new Error(`clip insert failed: ${error.message}`);
  return clips.length;
}
