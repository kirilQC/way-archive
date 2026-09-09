import { db } from './supabase.js';
import { getUploadsPlaylistId, listUploads, getDurations } from './youtube.js';
import { fetchTranscript } from './transcript.js';
import { analyzeSermon } from './analyze.js';

const MIN_DURATION_SECONDS = 15 * 60; // skip shorts, clips, promos

export async function ingestVideo(video, durationSeconds) {
  const supabase = db();
  const base = {
    youtube_id: video.youtubeId,
    title: video.title,
    date: video.publishedAt.slice(0, 10),
    thumbnail: video.thumbnail,
    duration_seconds: durationSeconds,
  };

  try {
    const transcript = await fetchTranscript(video.youtubeId);
    const analysis = await analyzeSermon({ title: video.title, transcript });

    if (!analysis.is_sermon) {
      await supabase.from('sermons').upsert({ ...base, status: 'skipped' }, { onConflict: 'youtube_id' });
      return { youtubeId: video.youtubeId, status: 'skipped' };
    }

    await supabase.from('sermons').upsert(
      {
        ...base,
        transcript,
        summary: analysis.summary,
        highlights: analysis.highlights,
        notes: analysis.notes,
        bible_books: analysis.bible_books,
        verses: analysis.verses,
        topics: analysis.topics,
        speaker: analysis.speaker || null,
        status: 'published',
      },
      { onConflict: 'youtube_id' }
    );
    return { youtubeId: video.youtubeId, status: 'published' };
  } catch (err) {
    // Record the failure so we can retry later (next cron run will retry transcript_failed rows)
    await supabase
      .from('sermons')
      .upsert({ ...base, status: 'transcript_failed' }, { onConflict: 'youtube_id' });
    return { youtubeId: video.youtubeId, status: 'transcript_failed', error: String(err.message || err) };
  }
}

// Checks the channel's most recent uploads and ingests anything new
// (or anything that previously failed transcript fetch).
export async function ingestLatest({ limit = 10 } = {}) {
  const supabase = db();
  const playlistId = await getUploadsPlaylistId();
  const { videos } = await listUploads(playlistId, null, limit);
  if (!videos.length) return { checked: 0, processed: [] };

  const ids = videos.map((v) => v.youtubeId);
  const { data: existing, error } = await supabase
    .from('sermons')
    .select('youtube_id,status')
    .in('youtube_id', ids);
  if (error) throw new Error(`DB read failed: ${error.message}`);

  const done = new Map((existing || []).map((r) => [r.youtube_id, r.status]));
  const durations = await getDurations(ids);

  const processed = [];
  for (const video of videos) {
    const status = done.get(video.youtubeId);
    if (status && status !== 'transcript_failed') continue; // already handled
    const duration = durations.get(video.youtubeId) || 0;
    if (duration < MIN_DURATION_SECONDS) {
      if (!status) {
        await supabase.from('sermons').upsert(
          {
            youtube_id: video.youtubeId,
            title: video.title,
            date: video.publishedAt.slice(0, 10),
            thumbnail: video.thumbnail,
            duration_seconds: duration,
            status: 'skipped',
          },
          { onConflict: 'youtube_id' }
        );
      }
      continue;
    }
    processed.push(await ingestVideo(video, duration));
  }

  return { checked: videos.length, processed };
}
