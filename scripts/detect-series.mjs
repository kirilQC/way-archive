// One-time / rerunnable: assign consistent series names across the whole archive.
// Feeds all titles + dates + summary snippets to the AI in one pass so series
// naming stays consistent, then writes the `series` column.
// Run: node scripts/detect-series.mjs

import { readFileSync } from 'node:fs';

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
const { default: OpenAI } = await import('openai');

const supabase = db();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const { data: sermons, error } = await supabase
  .from('sermons')
  .select('id,title,date,summary')
  .eq('status', 'published')
  .order('date', { ascending: true });
if (error) throw new Error(error.message);

console.log(`Analyzing ${sermons.length} sermons for series...`);

const listing = sermons
  .map((s) => `${s.id} | ${s.date} | ${s.title} | ${(s.summary || '').slice(0, 160)}`)
  .join('\n');

const completion = await openai.chat.completions.create({
  model: process.env.OPENAI_MODEL || 'gpt-5-mini',
  messages: [
    {
      role: 'system',
      content:
        'You group church sermons into named series. Sermons in a series are usually consecutive weeks with a shared theme; summaries sometimes name the series explicitly (e.g. "part of a series called Money Moves") — prefer those exact names. Titles with a shared prefix/theme in consecutive weeks also indicate a series. Only assign a series when reasonably confident; standalone sermons get no entry. A series needs at least 2 sermons. Use one canonical name per series (consistent spelling/casing).',
    },
    {
      role: 'user',
      content: `Sermons (id | date | title | summary snippet), oldest first:\n\n${listing}`,
    },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'series_assignments',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assignments: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                series: { type: 'string' },
              },
              required: ['id', 'series'],
            },
          },
        },
        required: ['assignments'],
      },
    },
  },
});

const { assignments } = JSON.parse(completion.choices[0].message.content);
const validIds = new Set(sermons.map((s) => s.id));
const clean = assignments.filter((a) => validIds.has(a.id) && a.series.trim());

// Count per series
const counts = new Map();
for (const a of clean) counts.set(a.series, (counts.get(a.series) || 0) + 1);
const keep = clean.filter((a) => counts.get(a.series) >= 2);

console.log(`\nSeries found:`);
for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  if (n >= 2) console.log(`  ${name}: ${n} sermons`);
}

// Reset then apply, so reruns stay clean
await supabase.from('sermons').update({ series: null }).not('series', 'is', null);
for (const a of keep) {
  const { error: upErr } = await supabase.from('sermons').update({ series: a.series.trim() }).eq('id', a.id);
  if (upErr) throw new Error(upErr.message);
}

console.log(`\nDone. ${keep.length} sermons assigned to ${[...counts.values()].filter((n) => n >= 2).length} series.`);
