import AskClient from './AskClient.js';

export const metadata = { title: 'Ask — Way Church Sermon Archive' };

export default function AskPage() {
  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Ask the Archive</div>
        <h1>
          Ask <em>every sermon</em> at once.
        </h1>
      </section>
      <AskClient />
    </main>
  );
}
