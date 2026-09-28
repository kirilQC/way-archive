# Way Archive — context for Claude Code sessions

Sermon archive for Way Church, Nashville (https://www.waychurch.com/, YouTube @waynashville).
Built by Kiril Ivlev. Repo: kirilQC/way-archive (private). Live: way-ecru.vercel.app.

## Stack
- Next.js 15 App Router, plain JS (no TypeScript), server + client components
- Supabase Postgres (single `sermons` table), accessed via service-role key in `lib/supabase.js`
- Vercel Hobby; daily cron at 13:00 UTC hits `/api/cron/check` (ingests new uploads)
- OpenAI (Kiril's key, `OPENAI_MODEL` default `gpt-5-mini`) for sermon analysis, discussion
  questions, and Ask-the-Archive; structured outputs (`json_schema, strict:true`) everywhere
- Env in `.env.local`: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY, OPENAI_API_KEY,
  YT_TRANSCRIPT_IO_TOKEN (only needed in prod, see Gotchas)

## Hard rules
- **NO EM DASHES (or en dashes) may ever appear on the website.** Enforced three ways:
  1. `lib/text.js` `noDashes()/noDashesDeep()` sanitizes at render/API boundaries
     (SermonGrid, Archive, SermonView, /api/questions, /api/ask, /api/passage)
  2. All OpenAI prompts instruct "never use em dashes"
  3. `lib/ingest.js` runs `noDashesDeep()` over every analysis before upsert
  Keep this invariant when adding any new text surface.
- Browser tab title is just "Way Archive" (layout metadata; per-page metadata matches).
- Kiril runs SQL migrations himself: always paste runnable SQL inline in chat, never file paths.
- Auto-commit and push to GitHub without asking.

## Data pipeline
- `scripts/backfill.mjs` (`npm run backfill`): walks the whole channel via uploads playlist.
  Skips videos under 15 min (`skipped`). Failed captions -> `transcript_failed`, retried on rerun.
  `needsProcessing()` also reprocesses published rows missing `transcript_segments`
  (adds timestamped highlights to old rows).
- Transcripts fetched in `lib/transcript.js`: innertube (ANDROID client) first, then a
  youtube-transcript.io fallback (`YT_TRANSCRIPT_IO_TOKEN`, rate limit 5 req / 10s). Raw segments
  stored in `transcript_segments` (jsonb), plain text in `transcript`.
- `lib/analyze.js`: one structured OpenAI call -> summary, notes, highlights
  (`{text, start_seconds}`), verses, topics, bible_books, speaker, series, discussion_questions.
- `scripts/detect-series.mjs`: one OpenAI pass over all published titles/summaries; resets and
  reassigns the `series` column (kept only when >= 2 sermons). Rerun after big backfills.
- Topic tags: fixed list `TOPICS` (enum) + `TOPIC_RULES` in `lib/analyze.js`, 1-3 tags, primary
  first; `tidyTopics()` drops "Community" unless it is primary (the model over-applies it).
  `scripts/retag-topics.mjs` (dry run; `--write` applies, backing old tags up to a gitignored JSON)
  re-derives tags from stored summary/notes/highlights. Full retag done 2026-09-28.
- Full-text search: generated tsvector `fts` column + `search_sermons(q)` RPC returning
  `ts_headline` snippets with `<mark>`.

## Site map (tabs in app/components/NavTabs.js)
- `/` Sermons: hero (headline + stats left, featured latest card right), then the sermon grid.
  No search bar or filter chips by design; discovery happens via the other tabs and /ask.
  (The old search UI + /api/search route were removed; FTS still powers /ask retrieval.)
- `/series`, `/series/[name]` (empty until detect-series has run)
- `/speakers`, `/speakers/[name]`
- `/topics`, `/topics/[name]` (topic hubs with key-scripture chips)
- `/books`, `/books/[name]`: all 66 Bible books (canonical order, OT/NT columns from
  `lib/books.js`) with per-book sermon counters from `bible_books`; unpreached books dimmed
- `/ask`: unified multi-turn chat (`/api/ask`, streamed) answering both scripture questions and
  "what has Way taught about X". System prompt adapted from Cameron Pak's open-sourced Bible
  Bot prompt (MIT-0). The model NEVER writes verse text; prose modes stream answer text, then
  `###META###` + JSON (verse_references). Server appends `###DONE###` + {mode, verses,
  citations, sources}; client renders real NLT text via `/api/passage`.
  **Deep search (primary retrieval, `lib/deepsearch.js`):** every transcript is split into ~2 min
  passages with 20s overlap (`lib/chunks.js`, ~3,300 rows in `sermon_chunks`: pgvector 1536 +
  tsvector + raw caption `segments`, `text-embedding-3-small`, title prefixed into the embedded
  text). 75s passages were tested via the eval and were no better (and hit statement timeouts).
  Per question: `planSearch` (minimal reasoning) picks one of 6 modes plus rewritten query,
  keywords, strict book/speaker/date filters, verse ref, count -> `match_sermon_chunks` RPC
  (vector + keyword, RRF; retried unfiltered if empty, retried once on statement timeout) ->
  rerank top 40 at `low` reasoning (`minimal` tested, too loose). The reranker sees passages as
  `[m:ss]` lines labelled P1..Pn (it must answer with P numbers, not chunk ids) and picks exact
  spans; `snapSpan` snaps them to real caption segments and cuts the quote VERBATIM from the
  transcript, so quotes/timestamps never come from the model. Modes (route dispatch, `SHAPES`):
  - find: `###DONE###{mode:'list', topic, sources}`: sermons + up to 3 moments {start, note, quote}
  - clips: `findClips`, 20-100s spans snapped against the full sermon, hook + caption, CSV export
  - verse: `lib/verses.js` regex extracts spoken references ("Romans chapter 8 verse 28", "1st
    John 4") into `sermon_verse_mentions`; `lib/verseindex.js` `verseSearch` (no AI, ~3s) also
    folds in the analyzed `verses` jsonb. Book pages show most-preached chapters from it.
  - answer / compare / guide: prose from numbered citations `[n]` (MODE_BRIEF per mode;
    compare is chronological with headings, guide is week by week). Tail carries `citations`.
  Client (`AskClient.js`) renders `## ` headings, `- ` bullets, `**bold**`, `[n]` cite links,
  refine chips (speaker/year), and `/ask?q=...` auto-runs a question.
  Moment links go to `/sermon/[id]?t=seconds`, which starts the embed there.
  New sermons: `ingestVideo` indexes passages + verses. Backfill: `node scripts/index-transcripts.mjs
  [--all | --verses]`. If deep search throws, answers fall back to sermon-summary FTS.
  **Eval:** `node scripts/eval-ask.mjs [--only ids] [--save name]` runs `scripts/eval-cases.json`
  (30 cases: mode, hit, rank, moment window, filters, clips) through the same plan/retrieval.
  Run it before and after any search change. 2026-09-28: 29/30, p50 ~11s. Known miss:
  "church-name" (a one-sentence mention diluted inside a 2 min passage).
  **Ask log:** every request is logged to `sermon_ask_logs` (`lib/asklog.js`, never throws);
  private view at `/admin/asks?key=ADMIN_KEY` (env var, set in Vercel too).
- `/sermon/[id]`: YouTube embed (`enablejsapi=1`, postMessage seekTo for click-to-jump
  highlights + transcript timestamps), NLT verse text auto-loaded via `/api/passage`
  (bolls.life NLT, fallback bible-api.com WEB), collapsible full transcript
  (`/api/transcript`, segments grouped into ~45s blocks), lazy-generated discussion questions
  (`/api/questions`, persisted to `discussion_questions` after first generation)

## Gotchas
- YouTube's innertube player API now returns LOGIN_REQUIRED from datacenter IPs, so transcript
  fetching only works locally (residential IP). Production depends on the youtube-transcript.io
  fallback, so `YT_TRANSCRIPT_IO_TOKEN` must be set in Vercel or the daily cron silently stops
  ingesting new sermons.
- Vercel Hobby blocks deployments whose git commit author is not a project contributor. Commits
  must be authored as `262213075+kirilQC@users.noreply.github.com`; a commit authored
  `kiril@qcgrowth.com` was blocked and never deployed. Check the author before pushing.
- Selecting a column that doesn't exist yet 400s the whole Supabase query. Pattern used in
  `app/sermon/[id]/page.js` and `/api/questions`: catch the error and retry without the column.
- ~28 of the channel's uploads are <15 min shorts/promos, intentionally skipped, so published
  count will never equal the channel's total video count.
- Layout widths: main containers 1340px, detail page 1140px.
- Design follows the Way Church logo: navy (#1c3061) wordmark chip, navy-tinted dark palette,
  light-blue accent (the CSS var is still named --amber for historical reasons).
- `bible_books` must hold exact canonical names from `lib/books.js`; ingest normalizes via
  `canonicalBooks()` (aliases like "Psalm"/"Song of Songs" mapped, junk like "Corinthians" dropped).
- Speaker names: lead pastor is Noah Herrin. The model has produced "Noah" / "Noah Haron"; ingest maps
  these via `canonicalSpeaker()` in `lib/ingest.js` (add new aliases there).
- Footer shows "last synced @ ..." from newest `created_at` (America/Chicago).

## State / recurring tasks
- After any full backfill: run `node scripts/detect-series.mjs`, then spot-check the Series tab.
- Design mockups in `design-mockups/` are dead reference files (contain em dashes; not served).
