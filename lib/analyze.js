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
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'The highlight: a memorable quote, key point, or striking illustration. Quote directly when the wording is strong.' },
          start_seconds: { type: 'number', description: 'When this moment occurs in the video, in seconds, derived from the nearest [mm:ss] marker in the transcript.' },
        },
        required: ['text', 'start_seconds'],
      },
      description: '3-6 standout moments with their timestamps.',
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
    series: {
      type: 'string',
      description: 'Name of the sermon series if the speaker mentions being in one (e.g. "Money Moves"), else empty string. Use the exact series name as stated.',
    },
    discussion_questions: {
      type: 'array',
      items: { type: 'string' },
      description: '4-6 small-group discussion questions grounded in this specific sermon. Mix reflection ("when have you...") with application ("what would change if..."). No generic filler.',
    },
  },
  required: ['is_sermon', 'summary', 'highlights', 'notes', 'bible_books', 'verses', 'topics', 'speaker', 'series', 'discussion_questions'],
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
          'You analyze church sermon transcripts for a sermon archive. Be faithful to what was actually preached — never invent verses or quotes not present in the transcript. Transcripts come from YouTube auto-captions, so expect missing punctuation and occasional mis-transcribed words (especially names and scripture references); infer the intended words sensibly. The transcript contains [mm:ss] timestamp markers — use them to report accurate start_seconds for each highlight.',
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
