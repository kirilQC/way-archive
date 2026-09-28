// Private Ask log: /admin/asks?key=ADMIN_KEY. What people ask, which mode handled it, how
// long it took, and which questions came back empty (gaps in the archive or in Ask).
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Way Archive', robots: { index: false, follow: false } };

function when(ts) {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default async function AskLog({ searchParams }) {
  const { key } = await searchParams;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) notFound();

  const { data: rows, error } = await db()
    .from('sermon_ask_logs')
    .select('created_at,question,mode,result_count,latency_ms,error')
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    return (
      <main className="admin">
        <h1>Ask log</h1>
        <p className="admin-note">Log table not readable: {error.message}</p>
      </main>
    );
  }

  const byMode = {};
  for (const r of rows) byMode[r.mode || 'unknown'] = (byMode[r.mode || 'unknown'] || 0) + 1;
  const empty = rows.filter((r) => r.result_count === 0 || r.error);
  const lat = rows.map((r) => r.latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
  const pct = (p) => (lat.length ? `${(lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] / 1000).toFixed(1)}s` : 'n/a');

  return (
    <main className="admin">
      <h1>Ask log</h1>
      <div className="admin-stats">
        <div>
          <b>{rows.length}</b>
          <span>recent questions</span>
        </div>
        <div>
          <b>{empty.length}</b>
          <span>no results</span>
        </div>
        <div>
          <b>{pct(0.5)}</b>
          <span>median time</span>
        </div>
        <div>
          <b>{pct(0.95)}</b>
          <span>slowest 5%</span>
        </div>
      </div>
      <div className="admin-modes">
        {Object.entries(byMode)
          .sort((a, b) => b[1] - a[1])
          .map(([m, n]) => (
            <span key={m}>
              {m} <i>{n}</i>
            </span>
          ))}
      </div>

      {empty.length > 0 && (
        <>
          <h2>No results</h2>
          <table className="admin-table">
            <tbody>
              {empty.slice(0, 50).map((r, i) => (
                <tr key={i}>
                  <td>{when(r.created_at)}</td>
                  <td>{r.question}</td>
                  <td>{r.mode}</td>
                  <td>{r.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>All recent</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Question</th>
            <th>Mode</th>
            <th>Results</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.result_count === 0 || r.error ? 'miss' : ''}>
              <td>{when(r.created_at)}</td>
              <td>{r.question}</td>
              <td>{r.mode}</td>
              <td>{r.result_count ?? ''}</td>
              <td>{Number.isFinite(r.latency_ms) ? `${(r.latency_ms / 1000).toFixed(1)}s` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
