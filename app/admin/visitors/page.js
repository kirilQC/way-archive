// Private visitor log: /admin/visitors?key=ADMIN_KEY  (&days=7|30|90, &bots=1, &visitor=<id>)
// Nothing on the site links here. Page views are recorded server-side by middleware, device
// details by one browser report per session, questions by the Ask route.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Way Archive', robots: { index: false, follow: false } };

const TZ = 'America/Chicago';
const fmt = (ts, opts) => new Date(ts).toLocaleString('en-US', { timeZone: TZ, ...opts });
const when = (ts) => fmt(ts, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const time = (ts) => fmt(ts, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const dayKey = (ts) => fmt(ts, { year: 'numeric', month: '2-digit', day: '2-digit' });
const mins = (ms) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60000)} min`);

async function pageAll(build, max = 20000) {
  const out = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { error };
    out.push(...data);
    if (data.length < 1000) break;
  }
  return { data: out };
}

function place(e) {
  return [e?.city, e?.region, e?.country].filter(Boolean).join(', ') || 'Unknown location';
}
function device(e) {
  if (!e) return 'Unknown device';
  const hw = [e.device_vendor, e.device_model].filter(Boolean).join(' ');
  const os = [e.os, e.os_version].filter(Boolean).join(' ');
  const br = [e.browser, e.browser_version?.split('.')[0]].filter(Boolean).join(' ');
  return [hw || (e.device_type ? e.device_type[0].toUpperCase() + e.device_type.slice(1) : null), os, br].filter(Boolean).join(' · ');
}

export default async function Visitors({ searchParams }) {
  const sp = await searchParams;
  if (!process.env.ADMIN_KEY || sp.key !== process.env.ADMIN_KEY) notFound();
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 7;
  const bots = sp.bots === '1';
  const only = sp.visitor || null;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const q = (extra) => `?key=${encodeURIComponent(sp.key)}&days=${days}${bots ? '&bots=1' : ''}${extra || ''}`;

  const [ev, asks] = await Promise.all([
    pageAll(() => {
      let b = db().from('sermon_site_events').select('*').gte('created_at', since).order('created_at', { ascending: false });
      if (only) b = b.eq('visitor_id', only);
      return b;
    }),
    pageAll(() => {
      let b = db()
        .from('sermon_ask_logs')
        .select('created_at,question,mode,result_count,latency_ms,visitor_id,session_id,error')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      if (only) b = b.eq('visitor_id', only);
      return b;
    }, 5000),
  ]);

  if (ev.error) {
    return (
      <main className="admin">
        <h1>Visitors</h1>
        <p className="admin-note">Events table not readable: {ev.error.message}</p>
      </main>
    );
  }

  const events = ev.data.filter((e) => bots || !e.is_bot);
  const questions = asks.data || [];

  // Sessions: server page views + the browser's device report + questions, grouped by session
  const sessions = new Map();
  const touch = (id, e) => {
    if (!sessions.has(id)) sessions.set(id, { id, visitor_id: e.visitor_id, views: [], info: null, server: null, asks: [], first: e.created_at, last: e.created_at });
    const s = sessions.get(id);
    if (e.created_at < s.first) s.first = e.created_at;
    if (e.created_at > s.last) s.last = e.created_at;
    return s;
  };
  for (const e of events) {
    if (!e.session_id) continue;
    const s = touch(e.session_id, e);
    if (e.event === 'client_info') s.info = e;
    else {
      s.views.push(e);
      s.server ||= e;
    }
  }
  for (const a of questions) if (a.session_id && sessions.has(a.session_id)) sessions.get(a.session_id).asks.push(a);
  const list = [...sessions.values()].filter((s) => s.views.length || s.info).sort((a, b) => (a.last < b.last ? 1 : -1));

  // Headline numbers
  const now = Date.now();
  const viewsOnly = events.filter((e) => e.event !== 'client_info');
  const uniq = (xs) => new Set(xs.map((e) => e.visitor_id).filter(Boolean)).size;
  const today = dayKey(now);
  const liveCut = new Date(now - 5 * 60000).toISOString();
  const live = list.filter((s) => s.last >= liveCut);
  const visitsBy = new Map();
  for (const s of list) visitsBy.set(s.visitor_id, (visitsBy.get(s.visitor_id) || 0) + 1);
  const tally = (xs, key) => {
    const m = new Map();
    for (const x of xs) {
      const k = key(x);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };

  return (
    <main className="admin">
      <div className="admin-top">
        <h1>Visitors</h1>
        <div className="admin-links">
          {[7, 30, 90].map((d) => (
            <Link key={d} href={`?key=${encodeURIComponent(sp.key)}&days=${d}${bots ? '&bots=1' : ''}${only ? `&visitor=${only}` : ''}`} className={d === days ? 'on' : ''}>
              {d} days
            </Link>
          ))}
          <Link href={`?key=${encodeURIComponent(sp.key)}&days=${days}${bots ? '' : '&bots=1'}${only ? `&visitor=${only}` : ''}`}>{bots ? 'Hide bots' : 'Show bots'}</Link>
          <Link href={`/admin/asks?key=${encodeURIComponent(sp.key)}`}>Ask log →</Link>
        </div>
      </div>
      {only && (
        <p className="admin-note">
          One visitor, {visitsBy.get(only) || 0} sessions · <Link href={q()}>show everyone</Link>
        </p>
      )}

      <div className="admin-stats">
        <div>
          <b>{live.length}</b>
          <span>on the site now</span>
        </div>
        <div>
          <b>{uniq(viewsOnly.filter((e) => dayKey(e.created_at) === today))}</b>
          <span>visitors today</span>
        </div>
        <div>
          <b>{uniq(viewsOnly)}</b>
          <span>visitors, {days} days</span>
        </div>
        <div>
          <b>{list.length}</b>
          <span>sessions</span>
        </div>
        <div>
          <b>{viewsOnly.length}</b>
          <span>page views</span>
        </div>
        <div>
          <b>{questions.length}</b>
          <span>Ask questions</span>
        </div>
      </div>

      <div className="admin-cols">
        <div>
          <h2>Top pages</h2>
          {tally(viewsOnly, (e) => e.path).map(([k, n]) => (
            <div key={k} className="admin-row">
              <span>{k}</span>
              <i>{n}</i>
            </div>
          ))}
        </div>
        <div>
          <h2>Top locations</h2>
          {tally(list, (s) => place(s.server)).map(([k, n]) => (
            <div key={k} className="admin-row">
              <span>{k}</span>
              <i>{n}</i>
            </div>
          ))}
        </div>
        <div>
          <h2>Devices</h2>
          {tally(list, (s) => [s.server?.device_type, s.server?.os].filter(Boolean).join(' · ')).map(([k, n]) => (
            <div key={k} className="admin-row">
              <span>{k}</span>
              <i>{n}</i>
            </div>
          ))}
        </div>
      </div>

      <h2>Sessions</h2>
      <div className="sessions">
        {list.slice(0, 300).map((s) => {
          const e = s.server || s.info;
          const i = s.info;
          const timeline = [
            ...s.views.map((v) => ({ t: v.created_at, kind: 'view', text: v.path + (v.query ? `?${v.query}` : ''), sub: v.navigation })),
            ...s.asks.map((a) => ({ t: a.created_at, kind: 'ask', text: a.question, sub: `${a.mode || ''}${a.result_count != null ? ` · ${a.result_count} results` : ''}${a.error ? ' · error' : ''}` })),
          ].sort((a, b) => (a.t < b.t ? -1 : 1));
          const visits = visitsBy.get(s.visitor_id) || 1;
          return (
            <details key={s.id} className={`session${s.last >= liveCut ? ' live' : ''}`}>
              <summary>
                <span className="s-when">{when(s.first)}</span>
                <span className="s-place">{place(e)}</span>
                <span className="s-dev">{device(e)}</span>
                <span className="s-nums">
                  {s.views.length} page{s.views.length === 1 ? '' : 's'}
                  {s.asks.length ? ` · ${s.asks.length} question${s.asks.length === 1 ? '' : 's'}` : ''} · {mins(new Date(s.last) - new Date(s.first))}
                </span>
                <span className={`s-tag${s.server?.new_visitor ? ' new' : ''}`}>{s.server?.new_visitor ? 'new' : visits > 1 ? `${visits} visits` : 'returning'}</span>
                {e?.is_bot && <span className="s-tag bot">bot</span>}
              </summary>
              <div className="s-detail">
                <dl>
                  <dt>IP</dt>
                  <dd>{e?.ip || 'n/a'}</dd>
                  <dt>Location</dt>
                  <dd>
                    {place(e)}
                    {e?.postal_code ? ` ${e.postal_code}` : ''}
                    {e?.latitude != null && (
                      <>
                        {' · '}
                        <a href={`https://www.google.com/maps?q=${e.latitude},${e.longitude}`} target="_blank" rel="noreferrer">
                          map (approximate)
                        </a>
                      </>
                    )}
                  </dd>
                  <dt>Device</dt>
                  <dd>{device(e)}</dd>
                  <dt>Screen</dt>
                  <dd>{i ? `${i.screen_w}×${i.screen_h} @${i.pixel_ratio}x · window ${i.viewport_w}×${i.viewport_h}` : 'n/a'}</dd>
                  <dt>Time zone</dt>
                  <dd>{i?.timezone || e?.ip_timezone || 'n/a'}</dd>
                  <dt>Language</dt>
                  <dd>{i?.languages || e?.accept_language || 'n/a'}</dd>
                  <dt>Hardware</dt>
                  <dd>
                    {i
                      ? [i.platform, i.cpu_cores && `${i.cpu_cores} cores`, i.device_memory && `${i.device_memory} GB+ memory`, i.touch_points ? `touch (${i.touch_points})` : 'no touch', i.connection, i.color_scheme && `${i.color_scheme} mode`]
                          .filter(Boolean)
                          .join(' · ')
                      : 'n/a'}
                  </dd>
                  <dt>Came from</dt>
                  <dd>{s.views.at(-1)?.referrer || i?.referrer || 'direct'}</dd>
                  <dt>User agent</dt>
                  <dd className="ua">{e?.user_agent || 'n/a'}</dd>
                  <dt>Visitor</dt>
                  <dd>
                    <Link href={q(`&visitor=${s.visitor_id}`)}>{s.visitor_id?.slice(0, 8)}</Link> · {visits} session{visits === 1 ? '' : 's'} in {days} days
                  </dd>
                </dl>
                <ol className="timeline">
                  {timeline.map((t, k) => (
                    <li key={k} className={t.kind}>
                      <span className="t-time">{time(t.t)}</span>
                      <span className="t-text">{t.kind === 'ask' ? `Asked: “${t.text}”` : t.text}</span>
                      {t.sub && <span className="t-sub">{t.sub}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          );
        })}
        {!list.length && <p className="admin-note">No visits recorded in this window yet.</p>}
      </div>
    </main>
  );
}
