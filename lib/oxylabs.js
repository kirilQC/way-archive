// Clip sources via the Oxylabs YouTube Downloader (source "youtube_download"). Oxylabs fetches
// just the clip's time range (plus padding) and uploads the MP4 straight into our private
// Supabase Storage bucket over the S3 protocol; the browser then downloads it with a signed URL
// and does the reframing + subtitles locally (app/clips/render.js).
// Env: OXYLABS_USERNAME, OXYLABS_PASSWORD, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY
import { db } from './supabase.js';

export const BUCKET = 'sermon-clip-sources';
const API = 'https://data.oxylabs.io/v1/queries';
const PAD = 10; // seconds on each side: room to adjust the clip in the studio, trimmed exactly on export

export function oxylabsConfigured() {
  return Boolean(
    process.env.OXYLABS_USERNAME &&
      process.env.OXYLABS_PASSWORD &&
      process.env.SUPABASE_S3_ACCESS_KEY_ID &&
      process.env.SUPABASE_S3_SECRET_ACCESS_KEY
  );
}

const auth = () => 'Basic ' + Buffer.from(`${process.env.OXYLABS_USERNAME}:${process.env.OXYLABS_PASSWORD}`).toString('base64');
const hms = (t) => {
  const s = Math.max(0, Math.round(t));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

// Where a clip range lives in the bucket; the range is part of the path so repeat exports reuse it
export function sourceSpan(youtubeId, start, end) {
  const from = Math.max(0, Math.floor(start - PAD));
  const to = Math.ceil(end + PAD);
  // Clips are at most 60s, so a padded range is at most ~80s: 1080p fits the bucket's 50 MB cap
  const quality = to - from <= 82 ? 1080 : 720;
  return { from, to, quality, folder: `clips/${youtubeId}/${from}-${to}-${quality}` };
}

async function findFile(folder) {
  const { data } = await db().storage.from(BUCKET).list(folder, { limit: 10 });
  const f = (data || []).find((x) => x.name.endsWith('.mp4'));
  return f ? `${folder}/${f.name}` : null;
}

async function signed(path) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw new Error(`signing failed: ${error.message}`);
  return data.signedUrl;
}

// -> { status: 'done', url, from } | { status: 'pending', job, from }
export async function requestSource(youtubeId, start, end) {
  const span = sourceSpan(youtubeId, start, end);
  const existing = await findFile(span.folder);
  if (existing) return { status: 'done', url: await signed(existing), ...span };

  const host = new URL(process.env.SUPABASE_URL).host;
  const key = encodeURIComponent(process.env.SUPABASE_S3_ACCESS_KEY_ID);
  const secret = encodeURIComponent(process.env.SUPABASE_S3_SECRET_ACCESS_KEY);
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'youtube_download',
      query: youtubeId,
      context: [
        { key: 'download_type', value: 'audio_video' },
        { key: 'video_quality', value: String(span.quality) },
        { key: 'start_at', value: hms(span.from) },
        { key: 'end_at', value: hms(span.to) },
      ],
      storage_type: 's3_compatible',
      storage_url: `https://${key}:${secret}@${host}/storage/v1/s3/${BUCKET}/${span.folder}/`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Oxylabs ${res.status}: ${body.message || JSON.stringify(body).slice(0, 200)}`);
  return { status: 'pending', job: body.id, ...span };
}

// -> { status: 'done', url } | { status: 'pending' } | { status: 'failed', error }
export async function sourceStatus(job, folder) {
  const existing = await findFile(folder);
  if (existing) return { status: 'done', url: await signed(existing) };
  const res = await fetch(`${API}/${encodeURIComponent(job)}`, { headers: { Authorization: auth() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { status: 'failed', error: `Oxylabs ${res.status}: ${body.message || ''}`.trim() };
  if (body.status === 'faulted' || body.status === 'failed') {
    return { status: 'failed', error: body.error || body.message || 'Oxylabs could not download this video' };
  }
  if (body.status === 'done') {
    // Oxylabs reports done a moment before the object is visible in storage
    const again = await findFile(folder);
    if (again) return { status: 'done', url: await signed(again) };
  }
  return { status: 'pending', oxylabs: body.status };
}

// Drop sources older than `days` so the bucket stays small (called from the daily cron)
export async function cleanupSources(days = 7) {
  const cutoff = Date.now() - days * 864e5;
  const { data: vids } = await db().storage.from(BUCKET).list('clips', { limit: 1000 });
  let removed = 0;
  for (const v of vids || []) {
    const { data: spans } = await db().storage.from(BUCKET).list(`clips/${v.name}`, { limit: 1000 });
    for (const s of spans || []) {
      const { data: files } = await db().storage.from(BUCKET).list(`clips/${v.name}/${s.name}`, { limit: 10 });
      const old = (files || []).filter((f) => f.created_at && new Date(f.created_at).getTime() < cutoff);
      if (old.length) {
        await db().storage.from(BUCKET).remove(old.map((f) => `clips/${v.name}/${s.name}/${f.name}`));
        removed += old.length;
      }
    }
  }
  return removed;
}
