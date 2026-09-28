// Records every page view server-side (sermon_site_events) and keeps first-party visitor and
// session cookies so visits, sessions, and Ask questions can be tied together in /admin/visitors.
// Runs for full page loads and client-side navigations; skips prefetches, assets, APIs, /admin.
import { NextResponse } from 'next/server';
import { requestInfo, insertEvent, VISITOR_COOKIE, SESSION_COOKIE } from './lib/track.js';

export const config = {
  matcher: ['/((?!_next/|api/|admin|ffmpeg/|favicon|robots|sitemap|.*\\.[a-zA-Z0-9]+$).*)'],
};

export function middleware(req, event) {
  const res = NextResponse.next();
  if (req.method !== 'GET') return res;
  const h = req.headers;
  const prefetch =
    h.get('next-router-prefetch') || h.get('purpose') === 'prefetch' || (h.get('sec-purpose') || '').includes('prefetch');
  if (prefetch) return res;

  const secure = req.nextUrl.protocol === 'https:';
  // Ignore an identical repeat within 2s (double requests, instant reloads)
  const last = req.cookies.get('way_last')?.value?.split('|');
  const now = Date.now();
  if (last && last[0] === req.nextUrl.pathname && now - Number(last[1]) < 2000) return res;
  res.cookies.set('way_last', `${req.nextUrl.pathname}|${now}`, { maxAge: 60, sameSite: 'lax', path: '/', secure });
  let visitorId = req.cookies.get(VISITOR_COOKIE)?.value;
  const newVisitor = !visitorId;
  if (!visitorId) visitorId = crypto.randomUUID();
  let sessionId = req.cookies.get(SESSION_COOKIE)?.value;
  const newSession = !sessionId;
  if (!sessionId) sessionId = crypto.randomUUID();

  res.cookies.set(VISITOR_COOKIE, visitorId, { maxAge: 60 * 60 * 24 * 400, sameSite: 'lax', path: '/', secure });
  // Rolling: a session ends after 30 minutes without a page view
  res.cookies.set(SESSION_COOKIE, sessionId, { maxAge: 30 * 60, sameSite: 'lax', path: '/', secure });

  const search = new URLSearchParams(req.nextUrl.search);
  search.delete('_rsc');
  event.waitUntil(
    insertEvent({
      event: newSession ? 'session_start' : 'pageview',
      new_visitor: newVisitor,
      visitor_id: visitorId,
      session_id: sessionId,
      path: req.nextUrl.pathname,
      query: search.toString().slice(0, 500) || null,
      referrer: (h.get('referer') || '').slice(0, 500) || null,
      navigation: h.get('rsc') ? 'client' : 'load',
      ...requestInfo(req),
    })
  );
  return res;
}
