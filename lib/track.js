// Visitor analytics (sermon_site_events), read by /admin/visitors. Edge-safe: used from
// middleware (every page request, server-side) and /api/track (one browser report per session).
// Location comes from Vercel's IP geolocation headers: usually the right city, not an address.
import UAParser from 'ua-parser-js';

export const VISITOR_COOKIE = 'way_vid';
export const SESSION_COOKIE = 'way_sid';
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|headless|lighthouse|pingdom|uptime|vercel|curl|wget|python-requests|axios|node-fetch|go-http/i;

const decode = (v) => {
  try {
    return v ? decodeURIComponent(v) : null;
  } catch {
    return v || null;
  }
};

// Everything the server can know about a request
export function requestInfo(req) {
  const h = req.headers;
  const ua = h.get('user-agent') || '';
  const r = new UAParser(ua).getResult();
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    ip: (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || null,
    country: h.get('x-vercel-ip-country') || null,
    region: h.get('x-vercel-ip-country-region') || null,
    city: decode(h.get('x-vercel-ip-city')),
    postal_code: h.get('x-vercel-ip-postal-code') || null,
    latitude: num(h.get('x-vercel-ip-latitude')),
    longitude: num(h.get('x-vercel-ip-longitude')),
    ip_timezone: h.get('x-vercel-ip-timezone') || null,
    user_agent: ua.slice(0, 500) || null,
    browser: r.browser.name || null,
    browser_version: r.browser.version || null,
    os: r.os.name || null,
    os_version: r.os.version || null,
    device_type: r.device.type || (ua ? 'desktop' : null),
    device_vendor: r.device.vendor || null,
    device_model: r.device.model || null,
    is_bot: BOT.test(ua) || !ua,
    accept_language: (h.get('accept-language') || '').slice(0, 120) || null,
  };
}

export async function insertEvent(row) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/sermon_site_events`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    // analytics must never break a page
  }
}
