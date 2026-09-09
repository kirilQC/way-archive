# Way Archive

Personal sermon archive for Way Church (Nashville). Auto-ingests the weekly sermon from
[@waynashville](https://www.youtube.com/@waynashville) — pulls the transcript, uses OpenAI to
extract scripture references, topic tags, a summary, highlights, and takeaway notes, and serves
it all in a searchable archive.

## Stack

- Next.js (App Router) on Vercel
- Supabase (Postgres) — one `sermons` table
- Vercel Cron — daily check at 13:00 UTC (`/api/cron/check`)
- OpenAI structured outputs for sermon analysis

## Setup

1. Create a Supabase project and run the SQL in the deploy notes (creates the `sermons` table).
2. Get a YouTube Data API v3 key (Google Cloud Console — free, no OAuth needed).
3. Copy `.env.example` to `.env.local` and fill in the values.
4. `npm install && npm run dev`
5. Backfill the whole channel history (run locally — transcript fetch is more reliable from a
   residential IP): `npm run backfill`. Rerun to retry any `transcript_failed` rows.

## Deploy

Import the repo on Vercel, add the same env vars, deploy. The cron in `vercel.json` runs once a
day (Hobby plan limit) and picks up new uploads; Sunday's sermon appears Monday morning.

## Statuses

- `published` — visible on the site
- `skipped` — not a sermon (worship set, promo) or under 15 minutes
- `transcript_failed` — captions couldn't be fetched; retried on every cron run / backfill rerun
