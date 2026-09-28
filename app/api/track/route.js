// One browser report per session: the details only the browser knows (screen, window,
// time zone, languages, touch, connection). Server-side fields are added from the request.
import { requestInfo, insertEvent, VISITOR_COOKIE, SESSION_COOKIE } from '../../../lib/track.js';

export const dynamic = 'force-dynamic';

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const str = (v, n = 120) => (typeof v === 'string' && v ? v.slice(0, n) : null);

export async function POST(request) {
  let b = {};
  try {
    b = JSON.parse(await request.text());
  } catch {}
  await insertEvent({
    event: 'client_info',
    visitor_id: request.cookies.get(VISITOR_COOKIE)?.value || str(b.visitor_id, 60),
    session_id: request.cookies.get(SESSION_COOKIE)?.value || str(b.session_id, 60),
    path: str(b.path, 300),
    referrer: str(b.referrer, 500),
    screen_w: int(b.screen_w),
    screen_h: int(b.screen_h),
    viewport_w: int(b.viewport_w),
    viewport_h: int(b.viewport_h),
    pixel_ratio: Number.isFinite(Number(b.pixel_ratio)) ? Number(b.pixel_ratio) : null,
    timezone: str(b.timezone, 60),
    language: str(b.language, 30),
    languages: str(b.languages, 200),
    touch_points: int(b.touch_points),
    connection: str(b.connection, 20),
    color_scheme: str(b.color_scheme, 10),
    cpu_cores: int(b.cpu_cores),
    device_memory: Number.isFinite(Number(b.device_memory)) ? Number(b.device_memory) : null,
    platform: str(b.platform, 60),
    ...requestInfo(request),
  });
  return new Response(null, { status: 204 });
}
