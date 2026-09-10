import { Fraunces, Inter } from 'next/font/google';
import Link from 'next/link';
import NavTabs from './components/NavTabs.js';
import { db } from '../lib/supabase.js';
import './globals.css';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif', weight: ['500', '600'] });
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: 'Way Church — Sermon Archive',
  description: 'Every Way Church sermon, transcribed, summarized, and searchable.',
};

async function lastSynced() {
  try {
    const { data } = await db()
      .from('sermons')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (!data?.created_at) return null;
    return new Date(data.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    });
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }) {
  const synced = await lastSynced();
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body>
        <header className="site-header">
          <Link href="/" className="logo">
            way<span>.</span> <em>archive</em>
          </Link>
          <NavTabs />
        </header>
        {children}
        <footer className="site-footer">
          Built by Kiril Ivlev
          {synced && <div className="synced">last synced @ {synced} CT</div>}
        </footer>
      </body>
    </html>
  );
}
