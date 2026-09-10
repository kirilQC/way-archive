import AskClient from './AskClient.js';

export const metadata = { title: 'Way Archive' };

export default function AskPage() {
  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <div className="kicker">Way Church · Ask</div>
        <h1>
          Scripture questions, <em>sermon answers.</em>
        </h1>
      </section>
      <AskClient />
    </main>
  );
}
