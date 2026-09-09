const API = 'https://www.googleapis.com/youtube/v3';

async function yt(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', process.env.YOUTUBE_API_KEY);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getUploadsPlaylistId() {
  const data = await yt('channels', {
    part: 'contentDetails',
    forHandle: process.env.YOUTUBE_CHANNEL_HANDLE || 'waynashville',
  });
  const channel = data.items?.[0];
  if (!channel) throw new Error('Channel not found for handle');
  return channel.contentDetails.relatedPlaylists.uploads;
}

// Returns { videos: [{youtubeId, title, publishedAt, thumbnail}], nextPageToken }
export async function listUploads(playlistId, pageToken = null, maxResults = 50) {
  const params = { part: 'snippet,contentDetails', playlistId, maxResults: String(maxResults) };
  if (pageToken) params.pageToken = pageToken;
  const data = await yt('playlistItems', params);
  const videos = (data.items || []).map((item) => ({
    youtubeId: item.contentDetails.videoId,
    title: item.snippet.title,
    publishedAt: item.contentDetails.videoPublishedAt || item.snippet.publishedAt,
    thumbnail:
      item.snippet.thumbnails?.maxres?.url ||
      item.snippet.thumbnails?.high?.url ||
      item.snippet.thumbnails?.medium?.url ||
      null,
  }));
  return { videos, nextPageToken: data.nextPageToken || null };
}

// Returns Map of videoId -> durationSeconds
export async function getDurations(videoIds) {
  const map = new Map();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const data = await yt('videos', { part: 'contentDetails', id: batch.join(',') });
    for (const item of data.items || []) {
      map.set(item.id, parseISODuration(item.contentDetails.duration));
    }
  }
  return map;
}

export function parseISODuration(iso) {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}
