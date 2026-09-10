import BibleClient from './BibleClient.js';

export const metadata = { title: 'Way Archive' };

export default function BiblePage() {
  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Bible</div>
        <h1>
          Ask anything <em>in Scripture.</em>
        </h1>
      </section>
      <BibleClient />
    </main>
  );
}
