import OpenAI from 'openai';

const TOPICS = [
  'Faith', 'Prayer', 'Money', 'Marriage', 'Relationships', 'Family',
  'Forgiveness', 'Suffering', 'Identity', 'Purpose', 'Holiness', 'Grace',
  'Evangelism', 'Community', 'Wisdom', 'Worship', 'Hope', 'Sin & Repentance',
  'Holy Spirit', 'Salvation', 'Discipleship', 'Generosity', 'Fear & Anxiety', 'Rest',
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    is_sermon: {
      type: 'boolean',
      description: 'True if this is a preached sermon/message. False for worship sets, announcements, testimonies, event promos, etc.',
    },
    summary: {
      type: 'string',
      description: 'A digestible 4-7 sentence summary for someone who missed the sermon. Capture the main argument and how it develops.',
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
      description: '3-6 standout moments: memorable quotes, key points, or striking illustrations. Quote directly when the wording is strong.',
    },
    notes: {
      type: 'string',
      description: 'Practical takeaways / application notes someone should write down. 2-4 sentences.',
    },
    bible_books: {
      type: 'array',
      items: { type: 'string' },
      description: 'Books of the Bible the sermon meaningfully engages with (e.g. "Luke", "Romans"). Primary passage first.',
    },
    verses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reference: { type: 'string', description: 'e.g. "Luke 14:25-33"' },
          quote: { type: 'string', description: 'Short excerpt or paraphrase of the verse as used in the sermon' },
        },
        required: ['reference', 'quote'],
      },
      description: 'Specific scripture references cited, primary passage first. Max 6.',
    },
    topics: {
      type: 'array',
      items: { type: 'string' },
      description: `2-4 topic tags. Prefer tags from this list: ${TOPICS.join(', ')}. Add a freeform tag only if none fit.`,
    },
    speaker: {
      type: 'string',
      description: 'Name of the preacher if identifiable from the transcript or title, else empty string.',
    },
  },
  required: ['is_sermon', 'summary', 'highlights', 'notes', 'bible_books', 'verses', 'topics', 'speaker'],
};

let openai;

export async function analyzeSermon({ title, transcript }) {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Guard against extremely long transcripts (a 45-min sermon is ~8-10k words, well within limits)
  const trimmed = transcript.length > 120000 ? transcript.slice(0, 120000) : transcript;

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [
      {
        role: 'system',
        content:
          'You analyze church sermon transcripts for a sermon archive. Be faithful to what was actually preached — never invent verses or quotes not present in the transcript. Transcripts come from YouTube auto-captions, so expect missing punctuation and occasional mis-transcribed words (especially names and scripture references); infer the intended words sensibly.',
      },
      {
        role: 'user',
        content: `Video title: ${title}\n\nTranscript:\n${trimmed}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'sermon_analysis', strict: true, schema: SCHEMA },
    },
  });

  return JSON.parse(completion.choices[0].message.content);
}
