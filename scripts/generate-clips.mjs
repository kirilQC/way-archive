// Rerunnable: build auto clip packs (sermon_clips, kind 'auto') for published sermons.
// Skips sermons that already have auto clips unless --all. Custom clips are never touched.
// Run: node scripts/generate-clips.mjs [--all] [--limit N]

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
const { generateClipPack, saveClipPack } = await import('../lib/clips.js');

const ALL = process.argv.includes('--all');
const li = process.argv.indexOf('--limit');
const LIMIT = li === -1 ? Infinity : Number(process.argv[li + 1]);

const { data: sermons, error } = await db()
  .from('sermons')
  .select('id,title,speaker,date,transcript_segments')
  .eq('status', 'published')
  .order('date', { ascending: false });
if (error) throw error;

const have = new Set();
if (!ALL) {
  const { data, error: e } = await db().from('sermon_clips').select('sermon_id').eq('kind', 'auto').range(0, 9999);
  if (e) throw new Error(`sermon_clips not readable (run the migration first): ${e.message}`);
  data.forEach((r) => have.add(r.sermon_id));
}
const todo = sermons.filter((s) => !have.has(s.id)).slice(0, LIMIT);
console.log(`${sermons.length} published, ${todo.length} to generate`);

let clips = 0;
let failed = 0;
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < todo.length) {
      const s = todo[next++];
      try {
        const n = await saveClipPack(s.id, await generateClipPack(s));
        clips += n;
        process.stdout.write('.');
      } catch (err) {
        failed++;
        console.error(`\n  failed: ${s.title}: ${err.message}`);
      }
    }
  })
);
console.log(`\nGenerated ${clips} clips for ${todo.length - failed} sermons${failed ? `, ${failed} failed (rerun to retry)` : ''}.`);
