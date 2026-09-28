import OpenAI from 'openai';

export const TOPICS = [
  'Prayer', 'Money', 'Marriage', 'Relationships', 'Family',
  'Forgiveness', 'Suffering', 'Identity', 'Purpose', 'Holiness', 'Grace',
  'Evangelism', 'Community', 'Wisdom', 'Worship', 'Hope', 'Sin & Repentance',
  'Holy Spirit', 'Salvation', 'Generosity', 'Fear & Anxiety', 'Rest', 'Gratitude',
];

// Shared by analyzeSermon and scripts/retag-topics.mjs. Tags were over-applied
// ("Community" on a third of sermons), so every tag must be a real theme.
export const TOPIC_RULES = `Topic tags: 1-3 tags from the fixed list, primary theme FIRST. Only tag a topic if a listener would say the sermon is about it, not because it is mentioned or applied in passing. Most sermons deserve 1-2 tags; use 3 only when a sermon truly develops three themes. If the sermon's main subject matches a tag on the list (e.g. a sermon teaching on prayer), that tag MUST be first. Definitions for commonly over-used tags:
- Community: the sermon is mainly about church life, belonging, friendship, or doing life together. Not just because it ends with "get in a group".
- Generosity: giving, tithing, or open-handed living is a central theme. Not for serving or using your gifts in general.
- Money: finances, wealth, debt, materialism, or contentment with possessions.
- Grace: God's unearned favor is a central theme, not just mentioned in the gospel close.
- Holiness: pursuing purity, obedience, or set-apart living is the main call.
- Identity: who we are in Christ, worth, approval, or self-image is the main theme.
- Hope: enduring hope, encouragement in hard seasons, or future glory is central.
- Purpose: calling, mission, or what to do with your life is central.
- Salvation: the gospel, being saved, or who Jesus is is the main message.
- Worship: worship, idolatry, or what we love most is the main theme.`;

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
      description: 'Books of the Bible the sermon meaningfully engages with. Primary passage first. Use exact canonical names only: "Psalms" not "Psalm", "Song of Solomon" not "Song of Songs", always numbered ("1 Corinthians", never "Corinthians"), no parentheses or notes.',
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
      items: { type: 'string', enum: TOPICS },
      description: TOPIC_RULES,
    },
    speaker: {
      type: 'string',
      description: 'Full name of the preacher if identifiable from the transcript or title, else empty string. The lead pastor is Noah Herrin: if the preacher is "Noah" or "Pastor Noah", use "Noah Herrin".',
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

// The model still tacks "Community" onto sermons that merely end with "get in a group",
// so it only survives as the primary tag.
export function tidyTopics(tags) {
  const list = [...new Set(tags || [])].slice(0, 3);
  return list.filter((t, i) => t !== 'Community' || i === 0);
}

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
          'You analyze church sermon transcripts for a sermon archive. Be faithful to what was actually preached — never invent verses or quotes not present in the transcript. Transcripts come from YouTube auto-captions, so expect missing punctuation and occasional mis-transcribed words (especially names and scripture references); infer the intended words sensibly. The transcript contains [mm:ss] timestamp markers — use them to report accurate start_seconds for each highlight. Never use em dashes or en dashes in any output field; use commas, periods, colons, or hyphens instead.',
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

  const analysis = JSON.parse(completion.choices[0].message.content);
  return { ...analysis, topics: tidyTopics(analysis.topics) };
}
