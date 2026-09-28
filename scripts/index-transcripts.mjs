// Rerunnable: split every published sermon's transcript into timestamped passages,
// embed them, and store them in sermon_chunks for deep search. Skips sermons that
// already have passages unless --all is passed.
// Run: node scripts/index-transcripts.mjs [--all]

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
const { indexSermon } = await import('../lib/chunks.js');

const ALL = process.argv.includes('--all');

const { data: sermons, error } = await db()
  .from('sermons')
  .select('id,title,transcript_segments')
  .eq('status', 'published');
if (error) throw error;

let done = new Set();
if (!ALL) {
  // Page through existing passages to find sermons already indexed
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await db().from('sermon_chunks').select('sermon_id').range(from, from + 999);
    if (e) throw new Error(`sermon_chunks not readable (run the migration first): ${e.message}`);
    data.forEach((r) => done.add(r.sermon_id));
    if (data.length < 1000) break;
  }
}

const todo = sermons.filter((s) => !done.has(s.id));
console.log(`${sermons.length} published, ${todo.length} to index`);

let passages = 0;
let failed = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < todo.length) {
      const s = todo[next++];
      try {
        const n = await indexSermon(s);
        passages += n;
        process.stdout.write('.');
      } catch (err) {
        failed++;
        console.error(`\n  failed: ${s.title}: ${err.message}`);
      }
    }
  })
);
console.log(`\nIndexed ${todo.length - failed} sermons, ${passages} passages${failed ? `, ${failed} failed (rerun to retry)` : ''}.`);
