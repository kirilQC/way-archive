// Private log of Ask usage (sermon_ask_logs), read by /admin/asks and /admin/visitors.
// `who` ties a question to the visitor/session cookies and request location. Never throws:
// logging must not break an answer, and it silently no-ops until the table exists.
import { db } from './supabase.js';

export async function logAsk({ question, mode, plan, resultCount, topIds, latencyMs, error, who }) {
  try {
    await db()
      .from('sermon_ask_logs')
      .insert({
        question: String(question || '').slice(0, 2000),
        mode: mode || null,
        plan: plan || null,
        result_count: resultCount ?? null,
        top_ids: (topIds || []).slice(0, 10),
        latency_ms: latencyMs ?? null,
        error: error ? String(error).slice(0, 500) : null,
        ...(who || {}),
      });
  } catch {
    // ignore
  }
}
