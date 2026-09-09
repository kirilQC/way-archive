import { Fraunces, Inter } from 'next/font/google';
import Link from 'next/link';
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
          <nav>
            <a href="https://www.youtube.com/@waynashville" target="_blank" rel="noreferrer">
              YouTube ↗
            </a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">Way Church, Nashville · auto-synced from YouTube daily</footer>
      </body>
    </html>
  );
}
