'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { noDashes } from '../../../lib/text.js';

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Verse({ reference, quote }) {
  const [passage, setPassage] = useState(null); // { text, translation } | { error }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/passage?ref=${encodeURIComponent(reference)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && setPassage(data))
      .catch(() => !cancelled && setPassage({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [reference]);

  return (
    <div className="verse open">
      <b>{reference}</b>
      {passage?.text ? (
        <span>
          “{noDashes(passage.text)}
          {passage.truncated ? '…' : '”'} <i className="verse-trans">({passage.translation})</i>
        </span>
      ) : (
        <span>{noDashes(quote)}</span>
      )}
    </div>
  );
}

// Group raw caption segments into ~45-second paragraphs
function groupSegments(segments, windowSeconds = 45) {
  const blocks = [];
  let current = null;
  for (const seg of segments) {
    if (!current || seg.start - current.start >= windowSeconds) {
      current = { start: seg.start, text: seg.text };
      blocks.push(current);
    } else {
      current.text += ' ' + seg.text;
    }
  }
  return blocks;
}

function DiscussionQuestions({ sermonId }) {
  const [questions, setQuestions] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/questions?id=${sermonId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => !cancelled && setQuestions(data.questions || []))
      .catch(() => !cancelled && setQuestions([]));
    return () => {
      cancelled = true;
    };
  }, [sermonId]);

  if (questions && questions.length === 0)
    return <p className="panel-text">No discussion questions for this one.</p>;
  if (!questions) return <p className="panel-text">Writing questions from the transcript…</p>;
  return (
    <div className="sd-qgrid">
      {questions.map((q, i) => (
        <div key={i} className="sd-qcard">
          <b>{String(i + 1).padStart(2, '0')}</b>
          <p>{noDashes(q)}</p>
        </div>
      ))}
    </div>
  );
}

function Transcript({ sermonId, onSeek }) {
  const [data, setData] = useState(null); // { segments } | { text } | { error }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/transcript?id=${sermonId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData({ error: true }));
    return () => {
      cancelled = true;
    };
  }, [sermonId]);

  if (!data) return <p className="panel-text">Loading transcript…</p>;
  if (data.error) return <p className="panel-text">Transcript unavailable.</p>;
  if (data.segments)
    return (
      <div className="transcript sd-transcript">
        {groupSegments(data.segments).map((b, i) => (
          <div key={i} className="transcript-block">
            <button className="hl-time" onClick={() => onSeek(b.start)}>
              {formatTime(b.start)}
            </button>
            <p>{noDashes(b.text)}</p>
          </div>
        ))}
      </div>
    );
  return (
    <div className="transcript sd-transcript">
      <p className="panel-text">{noDashes(data.text)}</p>
    </div>
  );
}

const TABS = ['Overview', 'Timeline', 'Scriptures', 'Discussion', 'Transcript'];

export default function SermonView({ sermon: s }) {
  const iframeRef = useRef(null);
  const [tab, setTab] = useState(0);
  const [openedTabs, setOpenedTabs] = useState([true, false, false, false, false]);
  const minutes = s.duration_seconds ? `${Math.floor(s.duration_seconds / 60)} min` : null;
  const title = (s.title || '').split('|')[0].trim();
  const highlights = (s.highlights || []).filter((h) => typeof h !== 'string');
  const pull = highlights.length
    ? highlights.reduce((a, b) => (b.text.length > a.text.length ? b : a))
    : null;

  const pick = (i) => {
    setTab(i);
    setOpenedTabs((prev) => prev.map((v, j) => v || j === i));
  };

  const seekTo = (seconds) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    for (const func of [['seekTo', [seconds, true]], ['playVideo', []]]) {
      win.postMessage(JSON.stringify({ event: 'command', func: func[0], args: func[1] }), '*');
    }
    iframeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <main className="sermon-cinema">
      <div className="sd-hero">
        {s.thumbnail && <div className="sd-bg" style={{ backgroundImage: `url(${s.thumbnail})` }} />}
        <div className="kicker">
          {formatDate(s.date)}
          {minutes ? ` · ${minutes}` : ''}
        </div>
        <h1>{title}</h1>
        <div className="sd-meta">
          {s.speaker && (
            <Link href={`/speakers/${encodeURIComponent(s.speaker)}`} className="meta-link">
              {s.speaker}
            </Link>
          )}
          {(s.verses || [])[0]?.reference && <> · {s.verses[0].reference}</>}
          {s.series && (
            <>
              {' · '}
              <Link href={`/series/${encodeURIComponent(s.series)}`} className="meta-link">
                {s.series} series
              </Link>
            </>
          )}
        </div>
        <div className="video-wrap sd-video">
          <iframe
            ref={iframeRef}
            src={`https://www.youtube.com/embed/${s.youtube_id}?enablejsapi=1`}
            title={s.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>

      <div className="sd-body">
        <div className="sd-tabs">
          {TABS.map((t, i) => (
            <button key={t} className={`sd-tab${tab === i ? ' on' : ''}`} onClick={() => pick(i)}>
              {t}
            </button>
          ))}
        </div>

        {/* Overview */}
        <div className="sd-pane" hidden={tab !== 0}>
          <div className="sd-ov">
            <div>
              <p className="sd-lead">{noDashes(s.summary)}</p>
              {pull && (
                <blockquote className="sd-quote">
                  “{noDashes(pull.text)}”
                  <small>
                    <button className="sd-quote-jump" onClick={() => seekTo(pull.start_seconds)}>
                      {formatTime(pull.start_seconds)}
                    </button>
                    {s.speaker ? ` · ${s.speaker}` : ''}
                  </small>
                </blockquote>
              )}
              {s.notes && (
                <>
                  <h4 className="sd-h4">Take it with you</h4>
                  <p className="sd-notes">{noDashes(s.notes)}</p>
                </>
              )}
            </div>
            <div className="sd-side">
              {highlights.length > 0 && (
                <section>
                  <h4 className="sd-h4">Highlights</h4>
                  {highlights.map((h, i) => (
                    <button key={i} className="hl hl-jump" onClick={() => seekTo(h.start_seconds)}>
                      <span className="hl-time">{formatTime(h.start_seconds)}</span>
                      <span>{noDashes(h.text)}</span>
                    </button>
                  ))}
                </section>
              )}
              {(s.verses || []).length > 0 && (
                <section>
                  <h4 className="sd-h4">Key Scriptures</h4>
                  {s.verses.slice(0, 4).map((v, i) => (
                    <Verse key={i} reference={v.reference} quote={v.quote} />
                  ))}
                </section>
              )}
              {(s.topics || []).length > 0 && (
                <section>
                  <h4 className="sd-h4">Topics</h4>
                  <div className="tags">
                    {s.topics.map((t) => (
                      <Link key={t} href={`/topics/${encodeURIComponent(t)}`} className="tag topic">
                        {t}
                      </Link>
                    ))}
                    {(s.bible_books || []).map((b) => (
                      <Link key={b} href={`/books/${encodeURIComponent(b)}`} className="tag book">
                        {b}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="sd-pane" hidden={tab !== 1}>
          <h4 className="sd-h4">The message, minute by minute</h4>
          <div className="sd-tl">
            {highlights.map((h, i) => (
              <button key={i} className="sd-node" onClick={() => seekTo(h.start_seconds)}>
                <span className="t">{formatTime(h.start_seconds)}</span>
                <p>{noDashes(h.text)}</p>
              </button>
            ))}
            {s.duration_seconds ? (
              <div className="sd-node end">
                <span className="t">{formatTime(s.duration_seconds)}</span>
                <p>End of message. Click any moment to jump the video there.</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Scriptures */}
        <div className="sd-pane" hidden={tab !== 2}>
          <h4 className="sd-h4">Scriptures, as preached</h4>
          {(s.verses || []).length ? (
            <div className="sd-vgrid">
              {s.verses.map((v, i) => (
                <Verse key={i} reference={v.reference} quote={v.quote} />
              ))}
            </div>
          ) : (
            <p className="panel-text">No scripture references recorded for this sermon.</p>
          )}
        </div>

        {/* Discussion */}
        <div className="sd-pane" hidden={tab !== 3}>
          <h4 className="sd-h4">For your group</h4>
          {openedTabs[3] && <DiscussionQuestions sermonId={s.id} />}
        </div>

        {/* Transcript */}
        <div className="sd-pane" hidden={tab !== 4}>
          <h4 className="sd-h4">Full transcript</h4>
          {openedTabs[4] && <Transcript sermonId={s.id} onSeek={seekTo} />}
        </div>
      </div>
    </main>
  );
}
