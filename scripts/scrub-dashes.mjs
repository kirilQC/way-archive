// One-time scrub: remove em/en dashes from all stored display fields.
// (Future rows are sanitized at ingest via noDashesDeep.)
import { readFileSync } from 'node:fs';
import { noDashesDeep } from '../lib/text.js';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { db } = await import('../lib/supabase.js');

const COLS = ['title', 'summary', 'notes', 'speaker', 'series', 'verses', 'highlights', 'topics', 'bible_books', 'discussion_questions'];

const { data, error } = await db().from('sermons').select(`id,${COLS.join(',')}`);
if (error) throw new Error(error.message);

let changed = 0;
for (const row of data) {
  const update = {};
  for (const col of COLS) {
    const clean = noDashesDeep(row[col]);
    if (JSON.stringify(clean) !== JSON.stringify(row[col])) update[col] = clean;
  }
  if (Object.keys(update).length) {
    const { error: e } = await db().from('sermons').update(update).eq('id', row.id);
    if (e) throw new Error(e.message);
    changed++;
  }
}
console.log(`Scrubbed dashes from ${changed} of ${data.length} rows.`);
