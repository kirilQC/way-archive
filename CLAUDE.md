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
  Bot prompt (MIT-0). Before the model runs, the last user message is FTS-searched and up to 4
  sermon summaries injected as context so it can cite what was preached. The model NEVER writes
  verse text; it streams answer text, then `###META###` + JSON (verse_references,
  sermon_search_query). Server appends `###DONE###` + {verses, sources (with thumbnails)};
  client renders real NLT text via `/api/passage` (no hallucinated quotes possible).
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
- Footer shows "last synced @ ..." from newest `created_at` (America/Chicago).

## State / recurring tasks
- After any full backfill: run `node scripts/detect-series.mjs`, then spot-check the Series tab.
- Design mockups in `design-mockups/` are dead reference files (contain em dashes; not served).
