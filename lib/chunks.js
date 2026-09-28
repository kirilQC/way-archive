// Transcript passages for deep search. Each sermon's caption segments are cut into
// ~2 minute timestamped passages (with a little overlap so a thought that straddles
// a boundary still lands whole in one passage), embedded with OpenAI, and stored in
// `sermon_chunks` (pgvector + tsvector). Searched by the match_sermon_chunks RPC.
import OpenAI from 'openai';
import { db } from './supabase.js';

export const EMBED_MODEL = 'text-embedding-3-small'; // 1536 dims, matches the SQL column
const WINDOW_SECONDS = 120;
const OVERLAP_SECONDS = 20;

let openai;
function client() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });
  return openai;
}

export function chunkSegments(segments) {
  const segs = (segments || []).filter((s) => s && typeof s.start === 'number' && s.text);
  const chunks = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i].start;
    let j = i;
    while (j < segs.length && segs[j].start - start < WINDOW_SECONDS) j++;
    const window = segs.slice(i, j);
    const end = segs[j]?.start ?? window.at(-1).start + 5;
    chunks.push({
      start_seconds: Math.floor(start),
      end_seconds: Math.ceil(end),
      text: window.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
    });
    if (j >= segs.length) break;
    // Step back so the next passage starts OVERLAP_SECONDS before this one ended
    let k = j;
    while (k > i + 1 && end - segs[k - 1].start < OVERLAP_SECONDS) k--;
    i = k;
  }
  // Fold a tiny trailing passage into the one before it
  if (chunks.length > 1 && chunks.at(-1).end_seconds - chunks.at(-1).start_seconds < 30) {
    const last = chunks.pop();
    chunks.at(-1).text += ' ' + last.text;
    chunks.at(-1).end_seconds = last.end_seconds;
  }
  return chunks;
}

export async function embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 96) {
    const res = await client().embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + 96) });
    out.push(...res.data.map((d) => d.embedding));
  }
  return out;
}

// The title rides along in the embedded text so a passage keeps its sermon's context.
function embedInput(title, chunk) {
  return `Sermon: ${String(title || '').split('|')[0].trim()}\n\n${chunk.text}`;
}

// Replaces a sermon's passages. Safe to rerun.
export async function indexSermon({ id, title, transcript_segments }) {
  const chunks = chunkSegments(transcript_segments);
  if (!chunks.length) return 0;
  const embeddings = await embedTexts(chunks.map((c) => embedInput(title, c)));
  const supabase = db();
  const { error: delErr } = await supabase.from('sermon_chunks').delete().eq('sermon_id', id);
  if (delErr) throw new Error(`chunk delete failed: ${delErr.message}`);
  const rows = chunks.map((c, idx) => ({ sermon_id: id, idx, ...c, embedding: embeddings[idx] }));
  const { error } = await supabase.from('sermon_chunks').insert(rows);
  if (error) throw new Error(`chunk insert failed: ${error.message}`);
  return rows.length;
}
