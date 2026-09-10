# Way Archive — context for Claude Code sessions

Sermon archive for Way Church, Nashville (https://www.waychurch.com/, YouTube @waynashville).
Built by Kiril Ivlev. Repo: kirilQC/way-archive (private). Live: way-ecru.vercel.app.

## Stack
- Next.js 15 App Router, plain JS (no TypeScript), server + client components
- Supabase Postgres (single `sermons` table), accessed via service-role key in `lib/supabase.js`
- Vercel Hobby; daily cron at 13:00 UTC hits `/api/cron/check` (ingests new uploads)
- OpenAI (Kiril's key, `OPENAI_MODEL` default `gpt-5-mini`) for sermon analysis, discussion
  questions, and Ask-the-Archive; structured outputs (`json_schema, strict:true`) everywhere
- Env in `.env.local`: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_API_KEY, OPENAI_API_KEY

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
- Transcripts fetched via innertube (ANDROID client) in `lib/transcript.js`; raw segments stored
  in `transcript_segments` (jsonb), plain text in `transcript`.
- `lib/analyze.js`: one structured OpenAI call -> summary, notes, highlights
  (`{text, start_seconds}`), verses, topics, bible_books, speaker, series, discussion_questions.
- `scripts/detect-series.mjs`: one OpenAI pass over all published titles/summaries; resets and
  reassigns the `series` column (kept only when >= 2 sermons). Rerun after big backfills.
- Full-text search: generated tsvector `fts` column + `search_sermons(q)` RPC returning
  `ts_headline` snippets with `<mark>`.

## Site map (tabs in app/components/NavTabs.js)
- `/` Sermons: hero + stats, search (server FTS w/ snippets, local fallback), book/topic filters,
  featured latest card, grid
- `/series`, `/series/[name]` (empty until detect-series has run)
- `/speakers`, `/speakers/[name]`
- `/topics`, `/topics/[name]` (topic hubs with key-scripture chips)
- `/ask`: RAG Q&A (`/api/ask`: keyword extraction -> FTS -> excerpt windows -> cited answer)
- `/sermon/[id]`: YouTube embed (`enablejsapi=1`, postMessage seekTo for click-to-jump
  highlights + transcript timestamps), NLT verse text auto-loaded via `/api/passage`
  (bolls.life NLT, fallback bible-api.com WEB), collapsible full transcript
  (`/api/transcript`, segments grouped into ~45s blocks), lazy-generated discussion questions
  (`/api/questions`, persisted to `discussion_questions` after first generation)

## Gotchas
- Selecting a column that doesn't exist yet 400s the whole Supabase query. Pattern used in
  `app/sermon/[id]/page.js` and `/api/questions`: catch the error and retry without the column.
- ~28 of the channel's uploads are <15 min shorts/promos, intentionally skipped, so published
  count will never equal the channel's total video count.
- Layout widths: main containers 1340px, detail page 1140px.
- Footer shows "last synced @ ..." from newest `created_at` (America/Chicago).

## State / recurring tasks
- After any full backfill: run `node scripts/detect-series.mjs`, then spot-check the Series tab.
- Design mockups in `design-mockups/` are dead reference files (contain em dashes; not served).
