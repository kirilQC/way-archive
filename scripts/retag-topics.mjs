// Rerunnable: re-derive topic tags for every published sermon using the strict
// TOPIC_RULES from lib/analyze.js (primary tag first, 1-3 tags, fixed list).
// Works from the stored summary, notes, and highlights, so no transcript refetch.
// Run: node scripts/retag-topics.mjs            (dry run: prints changes + tag counts)
//      node scripts/retag-topics.mjs --write    (writes; old tags backed up to scripts/retag-backup-*.json)

import { readFileSync, writeFileSync } from 'node:fs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.error('No .env.local found.');
  process.exit(1);
}

const { db } = await import('../lib/supabase.js');
const { TOPICS, TOPIC_RULES, tidyTopics } = await import('../lib/analyze.js');
const { default: OpenAI } = await import('openai');

const WRITE = process.argv.includes('--write');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5, timeout: 90_000 });

const { data: sermons, error } = await db()
  .from('sermons')
  .select('id,title,summary,notes,highlights,topics')
  .eq('status', 'published');
if (error) throw error;

async function retag(s) {
  const highlights = (s.highlights || []).map((h) => (typeof h === 'string' ? h : h.text)).join(' | ');
  const res = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: `You assign topic tags to sermons in a church sermon archive.\n\n${TOPIC_RULES}` },
      {
        role: 'user',
        content: `Title: ${s.title}\n\nSummary: ${s.summary || ''}\n\nTakeaways: ${s.notes || ''}\n\nHighlights: ${highlights}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'topics',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { topics: { type: 'array', items: { type: 'string', enum: TOPICS } } },
          required: ['topics'],
        },
      },
    },
  });
  const tags = tidyTopics(JSON.parse(res.choices[0].message.content).topics);
  return tags.length ? tags : s.topics;
}

// Small worker pool to stay well under rate limits
const results = new Map();
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < sermons.length) {
      const s = sermons[next++];
      try {
        results.set(s.id, await retag(s));
      } catch (err) {
        console.error(`  failed: ${s.title}: ${err.message}`);
      }
    }
  })
);

const count = (key) => {
  const c = {};
  for (const s of sermons) for (const t of key(s) || []) c[t] = (c[t] || 0) + 1;
  return c;
};
const before = count((s) => s.topics);
const after = count((s) => results.get(s.id) || s.topics);
console.log('\nTag counts (before -> after):');
for (const t of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => (after[b] || 0) - (after[a] || 0))) {
  console.log(`  ${t.padEnd(18)} ${String(before[t] || 0).padStart(3)} -> ${after[t] || 0}`);
}
const perSermon = (m) => (sermons.reduce((a, s) => a + (m(s) || []).length, 0) / sermons.length).toFixed(2);
console.log(`\nAvg tags per sermon: ${perSermon((s) => s.topics)} -> ${perSermon((s) => results.get(s.id))}`);
console.log(`Retagged ${results.size}/${sermons.length}\n`);
for (const s of sermons.slice(0, 15)) {
  console.log(`  ${s.title.split(/\s[|-]\s/)[0].padEnd(40)} ${(s.topics || []).join('/')}  ->  ${(results.get(s.id) || []).join('/')}`);
}

if (!WRITE) {
  console.log('\nDry run. Rerun with --write to apply.');
  process.exit(0);
}

const backup = new URL(`./retag-backup-${Date.now()}.json`, import.meta.url);
writeFileSync(backup, JSON.stringify(sermons.map(({ id, topics }) => ({ id, topics })), null, 2));
console.log(`\nBacked up old tags to ${backup.pathname}`);
for (const [id, topics] of results) {
  const { error: err } = await db().from('sermons').update({ topics }).eq('id', id);
  if (err) console.error(`  write failed ${id}: ${err.message}`);
}
console.log(`Wrote ${results.size} rows.`);
