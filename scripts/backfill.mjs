// One-time backfill of the channel's entire back catalog.
// Run locally (residential IP = reliable transcript fetch):  npm run backfill
// Reads env from .env.local

import { readFileSync } from 'node:fs';

// Minimal .env.local loader
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.error('No .env.local found — create one from .env.example first.');
  process.exit(1);
}

const { getUploadsPlaylistId, listUploads, getDurations } = await import('../lib/youtube.js');
const { ingestVideo } = await import('../lib/ingest.js');
const { db } = await import('../lib/supabase.js');

const MIN_DURATION_SECONDS = 15 * 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const supabase = db();
const playlistId = await getUploadsPlaylistId();

let pageToken = null;
let page = 0;
let ingested = 0;
let skipped = 0;
let failed = 0;

do {
  page++;
  const { videos, nextPageToken } = await listUploads(playlistId, pageToken);
  pageToken = nextPageToken;
  console.log(`\nPage ${page}: ${videos.length} videos`);

  const ids = videos.map((v) => v.youtubeId);
  const { data: existing } = await supabase.from('sermons').select('youtube_id,status').in('youtube_id', ids);
  const done = new Map((existing || []).map((r) => [r.youtube_id, r.status]));
  const durations = await getDurations(ids);

  for (const video of videos) {
    const status = done.get(video.youtubeId);
    if (status && status !== 'transcript_failed') {
      console.log(`  = already ${status}: ${video.title}`);
      continue;
    }
    const duration = durations.get(video.youtubeId) || 0;
    if (duration < MIN_DURATION_SECONDS) {
      console.log(`  - too short (${Math.round(duration / 60)}m), skipping: ${video.title}`);
      skipped++;
      continue;
    }
    process.stdout.write(`  > ingesting: ${video.title} ... `);
    const result = await ingestVideo(video, duration);
    console.log(result.status + (result.error ? ` (${result.error})` : ''));
    if (result.status === 'published') ingested++;
    else if (result.status === 'skipped') skipped++;
    else failed++;
    await sleep(1500); // be polite to YouTube
  }
} while (pageToken);

console.log(`\nDone. Published: ${ingested}, skipped: ${skipped}, failed: ${failed}`);
if (failed) console.log('Failed rows are marked transcript_failed and will be retried — rerun this script to retry.');
