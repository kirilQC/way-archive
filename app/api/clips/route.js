// Custom clips (Clips tab). Open to everyone by design (no passcode).
//   POST   { sermon_id, start_seconds, end_seconds, hook, caption, clip_type? }  -> saved clip
//   DELETE ?id=  (custom clips only; auto packs are regenerated, not hand-deleted)
//   PATCH  { sermon_id, start_seconds, end_seconds } -> suggested { hook, caption }
// The transcript of a clip is always cut server-side from the stored captions, never trusted
// from the client, so what is saved is exactly what was said.
import OpenAI from 'openai';
import { db } from '../../../lib/supabase.js';
import { noDashes } from '../../../lib/text.js';
import { wordTimes } from '../../../lib/deepsearch.js';
import { CLIP_TYPES } from '../../../lib/clips.js';

export const dynamic = 'force-dynamic';

let openai;

async function spanText(sermonId, start, end) {
  const { data } = await db().from('sermons').select('transcript_segments').eq('id', sermonId).single();
  const words = wordTimes(data?.transcript_segments || []).filter((w) => w.t >= start - 0.2 && w.t < end);
  return noDashes(words.map((w) => w.w).join(' '));
}

function span(body) {
  const start = Number(body.start_seconds);
  const end = Number(body.end_seconds);
  if (!body.sermon_id || !Number.isFinite(start) || !Number.isFinite(end) || end - start < 3 || end - start > 600) return null;
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
}

export async function POST(request) {
  const body = await request.json();
  const s = span(body);
  if (!s) return Response.json({ error: 'Invalid clip range' }, { status: 400 });
  const row = {
    sermon_id: body.sermon_id,
    kind: 'custom',
    clip_type: CLIP_TYPES[body.clip_type] ? body.clip_type : null,
    start_seconds: s.start,
    end_seconds: s.end,
    hook: noDashes(String(body.hook || '').slice(0, 140)),
    caption: noDashes(String(body.caption || '').slice(0, 600)),
    transcript: await spanText(body.sermon_id, s.start, s.end),
    created_by: String(body.created_by || '').slice(0, 60) || null,
  };
  const { data, error } = await db().from('sermon_clips').insert(row).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function DELETE(request) {
  const id = new URL(request.url).searchParams.get('id');
  const { error } = await db().from('sermon_clips').delete().eq('id', id).eq('kind', 'custom');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return new Response(null, { status: 204 });
}

export async function PATCH(request) {
  const body = await request.json();
  const s = span(body);
  if (!s) return Response.json({ error: 'Invalid clip range' }, { status: 400 });
  const text = await spanText(body.sermon_id, s.start, s.end);
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    reasoning_effort: 'minimal',
    messages: [
      {
        role: 'system',
        content:
          'You write social copy for Way Church (Nashville) sermon clips. Given the exact words of a clip, write a hook (on-screen opening text, at most 10 words, punchy, faithful to what is said) and a caption (1-2 sentences for the post, no hashtags). Never use em dashes or en dashes.',
      },
      { role: 'user', content: text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'copy',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { hook: { type: 'string' }, caption: { type: 'string' } },
          required: ['hook', 'caption'],
        },
      },
    },
  });
  const out = JSON.parse(res.choices[0].message.content);
  return Response.json({ hook: noDashes(out.hook), caption: noDashes(out.caption) });
}
