// Pulls the transcript (auto-generated or manual captions) for a YouTube video
// by scraping the watch page for the player response, then fetching the
// caption track in json3 format.

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function extractJson(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const braceStart = html.indexOf('{', start);
  if (braceStart === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(braceStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

export async function fetchTranscript(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Watch page fetch failed: ${res.status}`);
  const html = await res.text();

  const player = extractJson(html, 'ytInitialPlayerResponse');
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('No caption tracks available');

  // Prefer manual English captions, fall back to auto-generated (asr), then anything.
  const track =
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith('en')) ||
    tracks[0];

  const url = `${track.baseUrl}&fmt=json3`;
  const capRes = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!capRes.ok) throw new Error(`Caption fetch failed: ${capRes.status}`);
  const data = await capRes.json();

  const text = (data.events || [])
    .flatMap((e) => e.segs || [])
    .map((s) => s.utf8)
    .join('')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) throw new Error('Empty transcript');
  return text;
}
