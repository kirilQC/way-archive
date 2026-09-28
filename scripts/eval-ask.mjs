// Ask evaluation: runs every case in scripts/eval-cases.json through the same planning and
// retrieval the /api/ask route uses (not the prose writing), and scores:
//   mode     planner picked the expected mode
//   hit      an expected sermon is in the results (any), or every one is (all)
//   rank     position of the first expected sermon
//   moment   a returned moment in the target sermon lands inside the expected time window
//   filter   speaker filter honored / compare covers both preachers / enough usable clips
// Run: node scripts/eval-ask.mjs [--only id,id] [--save name]
// Results are written to scripts/eval-results/<name|latest>.json (gitignored) for comparison.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.error('No .env.local found.');
  process.exit(1);
}

const { planSearch, deepSearch, findClips, SHAPES } = await import('../lib/deepsearch.js');
const { verseSearch } = await import('../lib/verseindex.js');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const only = arg('--only')?.split(',');
const saveAs = arg('--save') || 'latest';

let cases = JSON.parse(readFileSync(new URL('./eval-cases.json', import.meta.url), 'utf8'));
if (only) cases = cases.filter((c) => only.includes(c.id));

const has = (title, want) => (title || '').toLowerCase().includes(want.toLowerCase());

async function run(c) {
  const history = [...(c.history || []), { role: 'user', content: c.q }];
  const t0 = Date.now();
  const plan = await planSearch(history);
  let mode = plan.mode;
  let sermons = [];
  let clips = [];
  if (mode === 'verse' && plan.verse) sermons = await verseSearch(plan.verse);
  else if (mode === 'clips') clips = (await findClips(history, { plan })).clips;
  else sermons = (await deepSearch(history, { plan, ...SHAPES[mode === 'verse' ? 'find' : mode] })).sermons;
  const ms = Date.now() - t0;

  const titles = clips.length ? clips.map((x) => x.title) : sermons.map((s) => s.title);
  const checks = { mode: mode === c.mode };
  if (c.any) {
    const idx = titles.findIndex((t) => c.any.some((w) => has(t, w)));
    checks.hit = idx !== -1;
    checks.rank = idx === -1 ? null : idx + 1;
  }
  if (c.all) {
    const found = c.all.filter((w) => titles.some((t) => has(t, w)));
    checks.hit = found.length === c.all.length;
    checks.recall = `${found.length}/${c.all.length}`;
  }
  if (c.moment) {
    const s = sermons.find((x) => has(x.title, c.moment.sermon));
    checks.moment = Boolean(s?.moments?.some((m) => m.start_seconds >= c.moment.from && m.start_seconds <= c.moment.to));
  }
  if (c.speaker) checks.filter = sermons.length > 0 && sermons.every((s) => s.speaker === c.speaker);
  if (c.speakersInclude) checks.filter = c.speakersInclude.every((sp) => sermons.some((s) => s.speaker === sp));
  if (c.minClips) {
    const good = clips.filter((x) => x.end_seconds - x.start_seconds >= 20 && x.end_seconds - x.start_seconds <= 110 && x.hook);
    checks.filter = good.length >= c.minClips;
    checks.clips = `${good.length}/${clips.length}`;
  }
  const pass = Object.entries(checks).every(([k, v]) => ['rank', 'recall', 'clips'].includes(k) || v !== false);
  return { id: c.id, q: c.q, pass, ms, checks, got: mode, top: titles.slice(0, 5) };
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < cases.length) {
      const c = cases[next++];
      try {
        results.push(await run(c));
      } catch (err) {
        results.push({ id: c.id, q: c.q, pass: false, error: err.message, checks: {} });
      }
    }
  })
);
results.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));

for (const r of results) {
  const detail = Object.entries(r.checks)
    .map(([k, v]) => `${k}=${v === true ? 'ok' : v === false ? 'FAIL' : v}`)
    .join(' ');
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(20)} ${String(r.ms ?? '').padStart(6)}ms  ${detail}${r.error ? `  error: ${r.error}` : ''}`);
  if (!r.pass && r.top) console.log(`      got ${r.got}: ${r.top.map((t) => t.split(/\s[|-]\s/)[0]).join(' | ')}`);
}
const lat = results.map((r) => r.ms).filter(Number.isFinite).sort((a, b) => a - b);
const q = (p) => (lat.length ? (lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] / 1000).toFixed(1) : '-');
const score = (k) => {
  const xs = results.filter((r) => r.checks[k] !== undefined);
  return `${xs.filter((r) => r.checks[k] === true).length}/${xs.length}`;
};
console.log(
  `\n${results.filter((r) => r.pass).length}/${results.length} passed · mode ${score('mode')} · hit ${score('hit')} · moment ${score('moment')} · filter ${score('filter')} · p50 ${q(0.5)}s · p95 ${q(0.95)}s`
);

mkdirSync(new URL('./eval-results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./eval-results/${saveAs}.json`, import.meta.url), JSON.stringify(results, null, 2));
