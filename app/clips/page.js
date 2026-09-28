import Link from 'next/link';
import { db } from '../../lib/supabase.js';
import { CLIP_TYPES } from '../../lib/clips.js';
import ClipSearch from './ClipSearch.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Way Archive' };

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cleanTitle = (t) => (t || '').split('|')[0].replace(/\s+-\s+[A-Z][\w'.]+(?:\s+[A-Z][\w'.]+){0,2}\s*$/, '').trim();
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function ClipTile({ c, s }) {
  return (
    <Link href={`/clips/${s.id}?clip=${c.id}`} className="ctile">
      <span className="ctile-thumb">
        {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
        <span className="ctile-len">{Math.round(c.end_seconds - c.start_seconds)}s</span>
      </span>
      <span className="ctile-body">
        <span className="ctile-meta">
          {c.clip_type && <i className={`ctype t-${c.clip_type}`}>{CLIP_TYPES[c.clip_type]}</i>}
          {clock(c.start_seconds)}
        </span>
        <b>{c.hook}</b>
      </span>
    </Link>
  );
}

export default async function ClipsPage({ searchParams }) {
  const { type } = await searchParams;
  const activeType = CLIP_TYPES[type] ? type : null;

  const [{ data: sermons }, { data: clips, error }] = await Promise.all([
    db().from('sermons').select('id,title,date,speaker,thumbnail').eq('status', 'published').order('date', { ascending: false }),
    db().from('sermon_clips').select('id,sermon_id,kind,clip_type,rank,start_seconds,end_seconds,hook').order('rank').range(0, 4999),
  ]);

  const bySermon = new Map();
  for (const c of clips || []) {
    if (!bySermon.has(c.sermon_id)) bySermon.set(c.sermon_id, []);
    bySermon.get(c.sermon_id).push(c);
  }
  const withClips = (sermons || []).filter((s) => bySermon.has(s.id));
  const latest = withClips[0];

  return (
    <main>
      <section className="hero">
        <div className="glow" />
        <h1>
          Sermon <em>clips.</em>
        </h1>
      </section>

      <div className="clips-wrap">
        <ClipSearch />

        {error && <div className="empty">Clips are not set up yet.</div>}

        {latest && !activeType && (
          <section className="clips-week">
            <div className="clips-week-head">
              <div>
                <div className="kicker">This week · {fmtDate(latest.date)}</div>
                <h2>{cleanTitle(latest.title)}</h2>
                <div className="clips-week-sub">
                  {latest.speaker} · {bySermon.get(latest.id).length} clips
                </div>
              </div>
              <Link href={`/clips/${latest.id}`} className="clips-open">
                Open studio →
              </Link>
            </div>
            <div className="ctile-grid">
              {bySermon.get(latest.id).map((c) => (
                <ClipTile key={c.id} c={c} s={latest} />
              ))}
            </div>
          </section>
        )}

        <div className="ctype-filter">
          <Link href="/clips" className={!activeType ? 'on' : ''}>
            All
          </Link>
          {Object.entries(CLIP_TYPES).map(([k, label]) => (
            <Link key={k} href={`/clips?type=${k}`} className={activeType === k ? 'on' : ''}>
              {label}
            </Link>
          ))}
        </div>

        {activeType ? (
          <div className="ctile-grid">
            {withClips.flatMap((s) =>
              bySermon
                .get(s.id)
                .filter((c) => c.clip_type === activeType)
                .map((c) => <ClipTile key={c.id} c={c} s={s} />)
            )}
          </div>
        ) : (
          <div className="clips-sermons">
            {withClips.map((s) => {
              const list = bySermon.get(s.id);
              const custom = list.filter((c) => c.kind === 'custom').length;
              return (
                <Link key={s.id} href={`/clips/${s.id}`} className="csermon">
                  {s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}
                  <span className="csermon-body">
                    <b>{cleanTitle(s.title)}</b>
                    <span>
                      {[s.speaker, fmtDate(s.date)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="csermon-n">
                    {list.length}
                    <i>{custom ? `${custom} custom` : 'clips'}</i>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
        {!withClips.length && !error && <div className="empty">No clips generated yet.</div>}
      </div>
    </main>
  );
}
