'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Sermons' },
  { href: '/series', label: 'Series' },
  { href: '/speakers', label: 'Speakers' },
  { href: '/topics', label: 'Topics' },
  { href: '/books', label: 'Books' },
  { href: '/ask', label: 'Ask' },
];

export default function NavTabs() {
  const pathname = usePathname();
  const isActive = (href) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/sermon/') : pathname.startsWith(href);

  return (
    <nav className="tabs-nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={isActive(t.href) ? 'tab active' : 'tab'}>
          {t.label}
        </Link>
      ))}
      <a href="https://www.youtube.com/@waynashville" target="_blank" rel="noreferrer" className="tab">
        YouTube ↗
      </a>
    </nav>
  );
}
