'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Sends the browser-only device details once per session (page views themselves are
// recorded server-side by middleware). Skips /admin.
export default function Tracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith('/admin')) return;
    const sid = document.cookie.match(/(?:^|; )way_sid=([^;]+)/)?.[1];
    const key = `way_ci_${sid || 'nosession'}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {}
    const nav = navigator;
    const body = JSON.stringify({
      path: pathname,
      referrer: document.referrer || null,
      screen_w: screen.width,
      screen_h: screen.height,
      viewport_w: window.innerWidth,
      viewport_h: window.innerHeight,
      pixel_ratio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: nav.language,
      languages: (nav.languages || []).join(','),
      touch_points: nav.maxTouchPoints,
      connection: nav.connection?.effectiveType,
      color_scheme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      cpu_cores: nav.hardwareConcurrency,
      device_memory: nav.deviceMemory,
      platform: nav.userAgentData?.platform || nav.platform,
    });
    const blob = new Blob([body], { type: 'application/json' });
    if (!nav.sendBeacon?.('/api/track', blob)) {
      fetch('/api/track', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  }, [pathname]);
  return null;
}
