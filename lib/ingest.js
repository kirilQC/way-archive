import { db } from './supabase.js';
import { getUploadsPlaylistId, listUploads, getDurations } from './youtube.js';
import { fetchTranscript, timestampedTranscript } from './transcript.js';
import { analyzeSermon } from './analyze.js';

const MIN_DURATION_SECONDS = 15 * 60; // skip shorts, clips, promos

export function needsProcessing(row) {
  if (!row) return true; // never seen
  if (row.status === 'transcript_failed') return true; // retry
  if (row.status === 'published' && !row.has_segments) return true; // pre-timestamp row
  return false;
}

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
    const { text: transcript, segments } = await fetchTranscript(video.youtubeId);
    const analysis = await analyzeSermon({
      title: video.title,
      transcript: timestampedTranscript(segments),
    });

    if (!analysis.is_sermon) {
      await supabase.from('sermons').upsert({ ...base, status: 'skipped' }, { onConflict: 'youtube_id' });
      return { youtubeId: video.youtubeId, status: 'skipped' };
    }

    await supabase.from('sermons').upsert(
      {
        ...base,
        transcript,
        transcript_segments: segments,
        summary: analysis.summary,
        highlights: analysis.highlights,
        notes: analysis.notes,
        bible_books: analysis.bible_books,
        verses: analysis.verses,
        topics: analysis.topics,
        speaker: analysis.speaker || null,
        series: analysis.series || null,
        status: 'published',
      },
      { onConflict: 'youtube_id' }
    );
    return { youtubeId: video.youtubeId, status: 'published' };
  } catch (err) {
    // Record the failure so we can retry later (next run retries transcript_failed rows)
    await supabase
      .from('sermons')
      .upsert({ ...base, status: 'transcript_failed' }, { onConflict: 'youtube_id' });
    return { youtubeId: video.youtubeId, status: 'transcript_failed', error: String(err.message || err) };
  }
}

export async function getExistingMap(youtubeIds) {
  const { data, error } = await db()
    .from('sermons')
    .select('youtube_id,status,has_segments:transcript_segments->0')
    .in('youtube_id', youtubeIds);
  if (error) throw new Error(`DB read failed: ${error.message}`);
  return new Map(
    (data || []).map((r) => [r.youtube_id, { status: r.status, has_segments: r.has_segments != null }])
  );
}

// Checks the channel's most recent uploads and ingests anything new,
// previously failed, or missing timestamp segments.
export async function ingestLatest({ limit = 10 } = {}) {
  const supabase = db();
  const playlistId = await getUploadsPlaylistId();
  const { videos } = await listUploads(playlistId, null, limit);
  if (!videos.length) return { checked: 0, processed: [] };

  const ids = videos.map((v) => v.youtubeId);
  const existing = await getExistingMap(ids);
  const durations = await getDurations(ids);

  const processed = [];
  for (const video of videos) {
    const row = existing.get(video.youtubeId);
    if (!needsProcessing(row ? { status: row.status, has_segments: row.has_segments } : null)) continue;
    const duration = durations.get(video.youtubeId) || 0;
    if (duration < MIN_DURATION_SECONDS) {
      if (!row) {
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
