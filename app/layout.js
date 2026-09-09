import { Fraunces, Inter } from 'next/font/google';
import Link from 'next/link';
import NavTabs from './components/NavTabs.js';
import './globals.css';

const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-serif', weight: ['500', '600'] });
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: 'Way Church — Sermon Archive',
  description: 'Every Way Church sermon, transcribed, summarized, and searchable.',
};

export default function RootLayout({ children }) {
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
        <footer className="site-footer">Way Church, Nashville · auto-synced from YouTube daily</footer>
      </body>
    </html>
  );
}
