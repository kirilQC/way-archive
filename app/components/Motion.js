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

    // Magnetic hero pill: pulls toward the cursor when nearby
    const stage = document.querySelector('.stage');
    const pill = document.querySelector('.stage-play');
    const onMove = (e) => {
      const mx = parseFloat(pill.style.getPropertyValue('--mx')) || 0;
      const my = parseFloat(pill.style.getPropertyValue('--my')) || 0;
      const r = pill.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2 - mx);
      const dy = e.clientY - (r.top + r.height / 2 - my);
      const dist = Math.hypot(dx, dy);
      const range = 200;
      const pull = dist < range ? (1 - dist / range) * 0.35 : 0;
      pill.style.setProperty('--mx', `${(dx * pull).toFixed(1)}px`);
      pill.style.setProperty('--my', `${(dy * pull).toFixed(1)}px`);
    };
    const onLeave = () => {
      pill.style.setProperty('--mx', '0px');
      pill.style.setProperty('--my', '0px');
    };
    if (stage && pill) {
      stage.addEventListener('mousemove', onMove);
      stage.addEventListener('mouseleave', onLeave);
    }

    return () => {
      io.disconnect();
      cio.disconnect();
      if (stage && pill) {
        stage.removeEventListener('mousemove', onMove);
        stage.removeEventListener('mouseleave', onLeave);
      }
    };
  }, [pathname]);

  return null;
}
