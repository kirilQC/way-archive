// Pulls the transcript (auto or manual captions) for a YouTube video via the
// innertube player API using the ANDROID client, whose caption URLs are served
// without the proof-of-origin token that blocks the web client's URLs.

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

const ANDROID_CONTEXT = {
  client: {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    hl: 'en',
  },
};

function clean(text) {
  return text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?39;/g, "'");
}

function parseJson3(raw) {
  const data = JSON.parse(raw);
  return (data.events || [])
    .flatMap((e) => e.segs || [])
    .map((s) => s.utf8)
    .join('');
}

// <timedtext format="3"> XML: text lives inside <p> elements (sometimes in <s> children)
function parseTimedTextXml(raw) {
  const paragraphs = [...raw.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  return paragraphs
    .map(([, inner]) => decodeEntities(inner.replace(/<[^>]+>/g, ' ')))
    .join(' ');
}

export async function fetchTranscript(videoId) {
  const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
    body: JSON.stringify({ context: ANDROID_CONTEXT, videoId }),
  });
  if (!playerRes.ok) throw new Error(`player API HTTP ${playerRes.status}`);
  const player = await playerRes.json();

  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') throw new Error(`video not playable: ${status}`);

  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('no caption tracks available');

  // Prefer manual English captions, fall back to auto-generated (asr), then anything.
  const track =
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith('en')) ||
    tracks[0];

  const capRes = await fetch(track.baseUrl, { headers: { 'User-Agent': ANDROID_UA } });
  if (!capRes.ok) throw new Error(`caption fetch HTTP ${capRes.status}`);
  const raw = (await capRes.text()).trim();
  if (!raw) throw new Error('caption endpoint returned empty body');

  const text = clean(raw.startsWith('{') ? parseJson3(raw) : parseTimedTextXml(raw));
  if (!text) throw new Error('empty transcript');
  return text;
}
