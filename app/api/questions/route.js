// Returns discussion questions for a sermon, generating and storing them on first request.
import OpenAI from 'openai';
import { db } from '../../../lib/supabase.js';
import { noDashes } from '../../../lib/text.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let openai;

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id required' }, { status: 400 });

  let { data: sermon, error } = await db()
    .from('sermons')
    .select('id,title,discussion_questions,transcript')
    .eq('id', id)
    .single();
  if (error?.message?.includes('discussion_questions')) {
    // column not migrated yet — generate without persisting
    ({ data: sermon } = await db().from('sermons').select('id,title,transcript').eq('id', id).single());
  }
  if (!sermon) return Response.json({ error: 'not found' }, { status: 404 });

  if (Array.isArray(sermon.discussion_questions) && sermon.discussion_questions.length) {
    return Response.json({ questions: sermon.discussion_questions.map(noDashes) });
  }
  if (!sermon.transcript) return Response.json({ questions: [] });

  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [
      {
        role: 'system',
        content:
          'Write 4-6 small-group discussion questions grounded in this specific sermon. Mix reflection ("when have you...") with application ("what would change if..."). Reference the sermon\'s actual illustrations and passages. No generic filler. Never use em dashes or en dashes; use commas, periods, or colons instead.',
      },
      {
        role: 'user',
        content: `Sermon: ${sermon.title}\n\nTranscript:\n${sermon.transcript.slice(0, 60000)}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'discussion_questions',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { questions: { type: 'array', items: { type: 'string' } } },
          required: ['questions'],
        },
      },
    },
  });

  const questions = JSON.parse(completion.choices[0].message.content).questions.map(noDashes);
  // Persist so we never regenerate (ignore failure if column isn't migrated yet)
  await db().from('sermons').update({ discussion_questions: questions }).eq('id', id);

  return Response.json({ questions });
}
