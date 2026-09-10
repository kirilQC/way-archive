'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function Motion() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Scroll reveal: fade-up elements as they enter the viewport, staggered per batch
    const io = new IntersectionObserver(
      (entries) => {
        let batch = 0;
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target;
          io.unobserve(el);
          el.style.setProperty('--d', `${Math.min(batch * 45, 450)}ms`);
          el.addEventListener('animationend', () => el.classList.remove('reveal', 'in'), {
            once: true,
          });
          el.classList.add('in');
          batch += 1;
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }
    );
    document.querySelectorAll('.reveal:not(.in)').forEach((el) => io.observe(el));

    // Count-up numbers when they scroll into view
    const cio = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const el = en.target;
          cio.unobserve(el);
          const end = parseInt(el.textContent, 10);
          if (!Number.isFinite(end) || end < 2) continue;
          const t0 = performance.now();
          const dur = 800;
          const tick = (t) => {
            const p = Math.min(1, (t - t0) / dur);
            el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3))));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    document.querySelectorAll('[data-countup]').forEach((el) => cio.observe(el));

    return () => {
      io.disconnect();
      cio.disconnect();
    };
  }, [pathname]);

  return null;
}
