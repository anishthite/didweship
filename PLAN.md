# NERV OS — Shipping Tracker

> _"Patterns blue and orange. Synchronization holding."_

A multi-user MAGI dashboard that tracks daily "did I ship?" output on GitHub and on X. Heatmaps, streaks, NERV chrome. Single Vercel deploy, no database, no second machine.

---

## §1. Mission

Make falling off the wagon visible enough that I don't.

- One summary screen plus per-user detail pages (MAGI-01 GitHub, MAGI-02 X).
- 53×7 contribution heatmap per panel.
- Current streak, longest streak, today count per panel.
- All data lives upstream — GitHub + X — and we pull from them on demand.
- Time zone: `America/Los_Angeles` (configurable via `NERV_TZ`).

Out of scope (deferred):

- Push / SMS / OS-level nudges (see Followups L-002).
- Manual `/api/ship` fallback for when the X data file is stale (L-001).
- Real-time X refresh (bounded by the hourly GH Action + Vercel rebuild; L-003).

---

## §2. Architecture — stateless, Vercel-only

```
┌──── ON VERCEL ────────────────────────────────────────────────┐
│                                                                │
│   Next.js 14 App Router                                        │
│     ▸ GET /                                                    │
│         page.tsx                                               │
│           getSnapshot(365)                                     │
│             ├ fetchGithubDays    next:{revalidate:3600}        │
│             └ fetchTwitterDays   import "./data/x-days-by-slug.json" │
│           computeStreak × 2 + combineDays                      │
│           render <MagiPanel/> × 2                              │
│                                                                │
│     ▸ GET /api/snapshot?days=N                                 │
│         same plumbing, returned as JSON                        │
│         cache-control: public, s-maxage=3600, swr=600          │
│                                                                │
│   No DB. No cron. No Mac. No pi-chrome.                        │
└────────────────────────────────────────────────────────────────┘
```

One upstream fetch (GitHub GraphQL) cached at the Next.js fetch layer for 1 hour; X day-counts are imported from a bundled JSON file refreshed daily by `.github/workflows/refresh-x-days.yml`. Streak math runs in-memory each SSR. The page itself is ISR (`export const revalidate = 3600`) so static visitors hit a CDN edge cache and rehydrate at most once per hour.

> Supersedes 2026-05-23 plan (Mac ingestor + Turso + pi-chrome). See `implementation-notes/2026-05-28-stateless-refactor.html` for the decision log.

---

## §3. Sources

### GitHub — GraphQL `contributionsCollection`

- Endpoint: `POST https://api.github.com/graphql`
- Auth: PAT with `read:user` (private contribs included).
- Window: 365 days, calendar-aligned to PT. We send an ISO window with a 1-day leading/trailing buffer (so PT midnights are fully covered), then trim back to the displayed `[from, to]` PT range in-memory.
- Cache: `next: { revalidate: 3600 }`.
- Cost: 1 GraphQL call per cache miss. GitHub limits = 5000/hr per token — irrelevant at this volume.

### X / Twitter — bundled JSON, refreshed hourly by GitHub Action (official X API v2)

- Render path: `apps/web/src/lib/twitter.ts` does `import xDaysData from "../data/x-days-by-slug.json"`. No network at request time.
- Refresh path: `.github/workflows/refresh-x-days.yml` runs hourly (`cron: "7 * * * *"`), invokes `pnpm tsx scripts/refresh-x-days.ts`, and commits the new counts back to `main`. Vercel rebuild ships the new data.
- Refresh script: looks up the numeric `user_id` via `GET /2/users/by/username/{handle}` (cached in the JSON), then pages `GET /2/users/:id/tweets?exclude=retweets,replies&tweet.fields=created_at`. Originals only — retweets and replies don't count as shipping. Steady state is a `since_id` incremental (newest seen ID persisted as `last_tweet_id` in the JSON), so each post is fetched and billed exactly once; quiet hours return 0 posts. Each tweet's `created_at` is bucketed via `Intl.DateTimeFormat("en-CA", { timeZone: NERV_TZ })` — matches `dateKey()` in `streak.ts` exactly. A `start_time` overlap window (last stored day − 2d) is used once per user to migrate pre-X-API data; older days are never decremented.
- Auth: `X_BEARER_TOKEN` (app-only bearer from developer.x.com) in GitHub repo secrets. Runtime app never reads it.
- Cost: pay-per-use (~$0.005/post returned). Steady state ≈ $1–3/mo for 2 users at hourly cadence. 402 response = out of credits → top up at developer.x.com.
- Failure: malformed/empty JSON → `TwitterFeedOfflineError` → panel hidden, combined streak drops to OR mode and reports GitHub only.
- **Tradeoff:** data freshness is bounded by the hourly Action + Vercel deploy. Tweets show up within ~1–2 hours. Re-run the workflow with `workflow_dispatch` for an ad-hoc refresh.

Earlier iterations: live-scrape approaches were blocked from Vercel egress IPs, then socialdata.tools was replaced by the official X API for real-time freshness (no third-party cache lag) and per-post pricing that makes hourly refresh cost-trivial. See `implementation-notes/2026-05-29-socialdata-migration.html` and `implementation-notes/2026-10-02-x-api-migration.html` for the decision logs.

---

## §4. Streak rules

- A day "ships" when `count >= 1`.
- Day keys are `YYYY-MM-DD` in `NERV_TZ` (default `America/Los_Angeles`).
- Per-channel:
  - `current` — walks backward from today across consecutive ship days. Today not yet shipped breaks the streak (no grace period).
  - `longest` — single pass over the visible window.
- Combined (`combined.mode = "and"`): a day counts only if **both** channels shipped.
- All math lives in `apps/web/src/lib/streak.ts` (pure, zero I/O).

---

## §5. Files

```
apps/web/
├── next.config.mjs         # tiny — reactStrictMode only
├── package.json            # next, react, tailwind. no libsql, no workspace deps
├── postcss.config.js
├── tailwind.config.ts      # NERV palette
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx        # SSR; export const revalidate = 3600
    │   ├── globals.css     # CRT scanlines, palette
    │   └── api/
    │       └── snapshot/
    │           └── route.ts  # GET /api/snapshot?days=N
    └── lib/
        ├── streak.ts       # pure math + tz helpers
        ├── github.ts       # GraphQL fetch + buffer/trim
        ├── twitter.ts      # reads bundled apps/web/src/data/x-days-by-slug.json
        ├── snapshot.ts     # composes everything; returns wire shape
        ├── heatmap.ts      # toWeeksGrid, intensity
        └── nerv/
            ├── MagiPanel.tsx
            └── Heatmap.tsx
```

No `packages/`. Single-app workspace.

---

## §6. Add people

- `GET /join` links to `.github/ISSUE_TEMPLATE/add-person.yml` on GitHub.
- The GitHub issue collects `displayName`, `githubLogin`, and `xLogin`.
- A maintainer adds one row to `apps/web/src/config/users.json`; roster changes stay file-based.
- New X data is not fetched in the request path; `x-days-by-slug.json` stays sparse until the scheduled refresh writes the new slug.

---

## §7. Environment variables

| Var | Required | Notes |
|---|---|---|
| `GITHUB_TOKEN` | **yes** | PAT with `read:user`. Private contribs require it. |
| `GITHUB_LOGIN` | optional | Legacy fallback only; roster entries supply handles. |
| `X_LOGIN` | optional | Legacy refresh-script override only; roster entries supply handles. |
| `X_BEARER_TOKEN` | refresh only | X API v2 app-only bearer; GitHub Actions secret, never runtime. |
| `NERV_TZ` | optional | IANA tz. Defaults to `America/Los_Angeles`. |

Set in `apps/web/.env.local` for dev. Set as Vercel project env vars for prod.

---

## §8. Followups (deferred, not part of v0)

- **L-001** — Manual ship fallback: `POST /api/ship` + an in-dashboard button. Useful when you want to mark "yes I posted" without waiting for the next hourly refresh to ship.
- **L-002** — Nudge mechanism: Vercel Cron at e.g. 18:00 + 23:00 PT hitting an `/api/nudge` route that pings Pushover / Resend / a Slack webhook when today is empty.
- **L-003** — ~~Sub-daily X freshness~~ DONE 2026-10-02: official X API + hourly cron. Remaining ceiling is the Vercel rebuild per data commit; a KV-backed runtime read would remove it.
- **L-004** — Build-time prerender wart: page is statically generated at build time with whatever data the build environment can reach. If `GITHUB_TOKEN` isn't set during the Vercel build, the SYS:FAULT branch gets baked in for up to an hour after deploy. Mitigations: set env at build, or flip `page.tsx` back to `force-dynamic` (fetch caching still works).

---

_Plan supersedes the 2026-05-23 Turso/pi-chrome architecture. Decision log: `implementation-notes/2026-05-28-stateless-refactor.html`._
