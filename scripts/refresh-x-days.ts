#!/usr/bin/env tsx
/**
 * refresh-x-days.ts — incremental refresh of apps/web/src/data/x-days-by-slug.json.
 *
 * Pulls each user's recent ORIGINAL posts from the official X API v2 user
 * timeline endpoint (retweets and replies excluded), buckets them into
 * `YYYY-MM-DD` day keys in NERV_TZ, merges into the bundled JSON, and writes
 * it back. Runs hourly from .github/workflows/refresh-x-days.yml.
 *
 * Inputs (env):
 *   X_BEARER_TOKEN     — required. App-only bearer token from developer.x.com.
 *                        Billing is pay-per-use (~$0.005/post returned), so the
 *                        since_id incremental path keeps steady-state cost at
 *                        "one tweet billed once, ever".
 *   X_LOGIN            — optional legacy single-user override (local testing).
 *   USERS_FILTER       — optional comma-separated slugs to refresh.
 *   NERV_TZ            — default "America/Los_Angeles". MUST match runtime tz.
 *   BACKFILL_SINCE     — default "2024-01-01". Only used when a slug has no
 *                        existing days[] (first-ever fetch for that user).
 *
 * Fetch modes (per user, decided from stored state):
 *   A. last_tweet_id present → since_id incremental. Only tweets newer than
 *      the last seen ID are returned; merge is ADDITIVE (count += new).
 *      Each tweet is billed once. Quiet hours return 0 posts ≈ $0.
 *   B. no last_tweet_id → start_time window (max(existing day) − 2d overlap,
 *      or BACKFILL_SINCE on empty days[]). Merge REPLACES the overlap window,
 *      never touches older days. Stores the newest seen ID as last_tweet_id,
 *      so this mode runs at most once per user (migration from pre-X-API
 *      data or first add). Note: the timeline endpoint caps at the 3200 most
 *      recent tweets — a brand-new heavy poster gets partial history (logged).
 *
 * Exit codes:
 *   0  success (data written, or no changes needed)
 *   1  API error (auth/network/4xx/5xx from api.x.com)
 *   2  validation / IO error (malformed JSON, write failure, bad env, etc.)
 */

import assert from "node:assert";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ----- multi-user roster ---------------------------------------------------
// Source of truth: apps/web/src/config/users.json (D-024). The script reads
// it directly rather than importing the .ts wrapper so it stays runnable
// without a TS path-alias resolver in Node.

// ----- types ----------------------------------------------------------------

type Day = { date: string; count: number };

type DataFile = {
  generated_at: string;
  user_id: string;
  handle: string;
  /** IANA tz used to bucket `days[]`. Stamped by this script so the runtime
   *  can refuse to render if the consumer's tz disagrees (F10). */
  bucketed_tz: string;
  /** Newest tweet ID ever processed — feeds `since_id` on the next run so
   *  each tweet is fetched (and billed) exactly once. "" until first seen. */
  last_tweet_id: string;
  days: Day[];
};

type DataBySlugFile = Record<string, DataFile>;

type XUserLookup = { data?: { id?: string; username?: string } };

type XTimelineResponse = {
  data?: Array<{ id?: string; created_at?: string }>;
  meta?: { next_token?: string; newest_id?: string; result_count?: number };
};

// ----- config ---------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const USERS_PATH = resolve(REPO_ROOT, "apps/web/src/config/users.json");
const DATA_PATH = resolve(REPO_ROOT, "apps/web/src/data/x-days-by-slug.json");

type RosterUser = {
  slug: string;
  displayName: string;
  githubLogin: string;
  xLogin: string;
};

async function loadRoster(): Promise<RosterUser[]> {
  let raw: string;
  try {
    raw = await readFile(USERS_PATH, "utf8");
  } catch (err) {
    die(2, `cannot read ${USERS_PATH}: ${err instanceof Error ? err.message : err}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(2, `${USERS_PATH} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  const users = (parsed as { users?: unknown })?.users;
  if (!Array.isArray(users) || users.length === 0) {
    die(2, `${USERS_PATH} must have a non-empty users[] array`);
  }
  const out: RosterUser[] = [];
  for (const u of users) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    if (
      typeof o.slug === "string" &&
      typeof o.displayName === "string" &&
      typeof o.githubLogin === "string" &&
      typeof o.xLogin === "string"
    ) {
      out.push({
        slug: o.slug,
        displayName: o.displayName,
        githubLogin: o.githubLogin,
        xLogin: o.xLogin,
      });
    }
  }
  if (out.length === 0) die(2, `${USERS_PATH}: no valid user entries`);
  return out;
}

const API_BASE = "https://api.x.com";
const OVERLAP_DAYS = 2;
// Hard guard against infinite-pagination bugs. 64 pages x 100 tweets = 6400,
// 2x the timeline endpoint's 3200-tweet ceiling, so a full backfill that
// legitimately ends stops long before this. Hitting it means a stuck token —
// throw rather than silently truncate.
const MAX_PAGES = 64;

// ----- logging --------------------------------------------------------------

const log = (msg: string) => {
  process.stderr.write(`[refresh-x-days] ${msg}\n`);
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function die(code: 1 | 2, msg: string): never {
  process.stderr.write(`[refresh-x-days] FATAL: ${msg}\n`);
  process.exit(code);
}

// ----- env ------------------------------------------------------------------

const BEARER_TOKEN = process.env.X_BEARER_TOKEN?.trim() ?? "";
// X_LOGIN env retained as an override for single-user runs (e.g. local
// testing of one slug). When set + USERS_FILTER is unset, the multi-user
// loop is bypassed in favor of the legacy single-user behavior.
const LEGACY_X_LOGIN = (process.env.X_LOGIN?.trim() || "").replace(/^@/, "");
// USERS_FILTER="anish,subby" → only refresh those slugs (debugging). Empty
// = refresh every slug in users.json.
const USERS_FILTER = (process.env.USERS_FILTER?.trim() || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TZ = process.env.NERV_TZ?.trim() || "America/Los_Angeles";
const BACKFILL_SINCE = (process.env.BACKFILL_SINCE?.trim() || "2024-01-01");
const SELF_TEST = process.env.SELF_TEST === "1";

if (!SELF_TEST && !BEARER_TOKEN) {
  die(2, "X_BEARER_TOKEN is required (developer.x.com → project → Keys and Tokens → Bearer Token)");
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(BACKFILL_SINCE)) {
  die(2, `BACKFILL_SINCE must be YYYY-MM-DD, got: ${BACKFILL_SINCE}`);
}

// ----- helpers --------------------------------------------------------------

/** Match streak.ts dateKey() exactly — same Intl call, same locale. */
const dateKey = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const addDaysISO = (yyyymmdd: string, n: number): string => {
  const [y, m, d] = yyyymmdd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}-${String(nd.getUTCDate()).padStart(2, "0")}`;
};

const isValidDayList = (v: unknown): v is Day[] => {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!item || typeof item !== "object") return false;
    const d = (item as { date?: unknown }).date;
    const c = (item as { count?: unknown }).count;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return false;
  }
  return true;
};

async function apiGet<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`;
  // Retry on 429/5xx, exponential backoff 1s/4s/16s, max 3 retries.
  // 4xx other than 429 throw immediately (auth/bad-request — not transient).
  const maxAttempts = 4; // 1 initial attempt + 3 retries
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          Accept: "application/json",
        },
      });
    } catch (err) {
      // Network-level failure (DNS, connection reset). Treat as retryable.
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        const waitMs = Math.pow(4, attempt - 1) * 1000; // 1s, 4s, 16s
        log(
          `fetch threw for ${path} (attempt ${attempt}/${maxAttempts}): ` +
            `${lastErr.message} — retrying in ${waitMs}ms`
        );
        await sleep(waitMs);
        continue;
      }
      break;
    }

    if (!res.ok) {
      const status = res.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      const body = await res.text().catch(() => "");
      // 402 = out of credits (pay-per-use). Loud, non-retryable — top up at
      // developer.x.com. Treated like any other non-retryable 4xx here; the
      // message is what matters.
      if (!isRetryable) {
        throw new Error(`HTTP ${status} for ${path}: ${body.slice(0, 300)}`);
      }
      if (attempt >= maxAttempts) {
        throw new Error(
          `HTTP ${status} for ${path} after ${attempt} attempts: ${body.slice(0, 300)}`
        );
      }
      let waitMs = Math.pow(4, attempt - 1) * 1000; // 1s, 4s, 16s
      if (status === 429) {
        const ra = res.headers.get("retry-after");
        if (ra) {
          const sec = parseInt(ra, 10);
          if (Number.isFinite(sec) && sec >= 0) waitMs = sec * 1000;
        }
      }
      log(
        `HTTP ${status} for ${path} (attempt ${attempt}/${maxAttempts}) — ` +
          `retrying in ${waitMs}ms`
      );
      await sleep(waitMs);
      continue;
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`HTTP ${res.status} non-JSON body at ${path}: ${text.slice(0, 200)}`);
    }
  }
  throw lastErr ?? new Error(`apiGet ${path} failed without a specific error`);
}

// ----- I/O ------------------------------------------------------------------

function emptyData(handle: string): DataFile {
  return {
    generated_at: "1970-01-01T00:00:00.000Z",
    user_id: "",
    handle,
    bucketed_tz: "",
    last_tweet_id: "",
    days: [],
  };
}

function parseDataFile(path: string, slug: string, v: unknown): DataFile {
  if (!v || typeof v !== "object") {
    die(2, `${path}: entry for slug=${slug} must be a JSON object`);
  }
  const obj = v as Record<string, unknown>;
  const days = obj.days;
  if (!isValidDayList(days)) {
    die(2, `${path}: invalid days[] for slug=${slug} (must be Array<{date:YYYY-MM-DD, count:number}>)`);
  }
  return {
    generated_at: typeof obj.generated_at === "string" ? obj.generated_at : "1970-01-01T00:00:00.000Z",
    user_id: typeof obj.user_id === "string" ? obj.user_id : "",
    handle: typeof obj.handle === "string" ? obj.handle : "",
    bucketed_tz: typeof obj.bucketed_tz === "string" ? obj.bucketed_tz : "",
    // Pre-X-API files have no last_tweet_id → "" → one start_time migration
    // fetch, then since_id forever.
    last_tweet_id: typeof obj.last_tweet_id === "string" ? obj.last_tweet_id : "",
    days,
  };
}

async function loadStore(): Promise<DataBySlugFile> {
  let raw: string;
  try {
    raw = await readFile(DATA_PATH, "utf8");
  } catch (err) {
    die(2, `cannot read ${DATA_PATH}: ${err instanceof Error ? err.message : err}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(2, `${DATA_PATH} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die(2, `${DATA_PATH} must be a slug-keyed JSON object`);
  }
  const out: DataBySlugFile = {};
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    out[slug] = parseDataFile(DATA_PATH, slug, value);
  }
  return out;
}

async function saveStore(store: DataBySlugFile): Promise<void> {
  const out: DataBySlugFile = {};
  for (const slug of Object.keys(store).sort()) {
    const data = store[slug]!;
    out[slug] = {
      ...data,
      days: [...data.days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    };
  }
  const json = JSON.stringify(out, null, 2) + "\n";
  // Write-temp-then-rename for atomicity.
  const tmp = DATA_PATH + ".tmp";
  await writeFile(tmp, json, "utf8");
  await rename(tmp, DATA_PATH);
}

// ----- main steps -----------------------------------------------------------

async function resolveUserId(handle: string, existing: DataFile): Promise<string> {
  if (existing.user_id && existing.handle === handle) {
    log(`user_id cached: ${existing.user_id} (handle=${handle})`);
    return existing.user_id;
  }
  log(`looking up user_id for handle=${handle}`);
  const u = await apiGet<XUserLookup>(`/2/users/by/username/${encodeURIComponent(handle)}`);
  const id = u.data?.id ?? "";
  if (!id) {
    throw new Error(`GET /2/users/by/username/${handle} returned no id (body: ${JSON.stringify(u).slice(0, 200)})`);
  }
  log(`resolved user_id=${id}`);
  return id;
}

function decideFetch(existing: DataFile): { sinceId?: string; startTime?: string; fullBackfill: boolean } {
  // Mode A: since_id incremental. Cheapest possible steady state.
  if (existing.last_tweet_id) {
    return { sinceId: existing.last_tweet_id, fullBackfill: false };
  }
  // Mode B: one-time start_time window (migration / first add / empty days).
  if (existing.days.length === 0) {
    return { startTime: `${BACKFILL_SINCE}T00:00:00Z`, fullBackfill: true };
  }
  // days[] is sorted at save time; take last entry's date.
  const maxDate = existing.days.reduce((acc, d) => (d.date > acc ? d.date : acc), existing.days[0]!.date);
  return { startTime: `${addDaysISO(maxDate, -OVERLAP_DAYS)}T00:00:00Z`, fullBackfill: false };
}

type FetchResult = {
  counts: Map<string, number>;
  /** Newest tweet ID seen this fetch ("" when nothing returned). */
  newestId: string;
  tweets: number;
};

async function fetchTweets(userId: string, opts: { sinceId?: string; startTime?: string }): Promise<FetchResult> {
  const counts = new Map<string, number>();
  let newestId = "";
  let tweets = 0;
  let pages = 0;
  let nextToken: string | undefined;
  let stoppedAtEnd = false;

  const tag = opts.sinceId ? `since_id=${opts.sinceId}` : `start_time=${opts.startTime}`;
  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({
      max_results: "100",
      "tweet.fields": "created_at",
      // "Shipped" = original posts only — no retweets, no replies.
      exclude: "retweets,replies",
    });
    if (opts.sinceId) params.set("since_id", opts.sinceId);
    else if (opts.startTime) params.set("start_time", opts.startTime!);
    if (nextToken) params.set("pagination_token", nextToken);
    const path = `/2/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`;
    pages++;
    log(`page ${pages} [${tag}]: GET ${path}`);

    const body = await apiGet<XTimelineResponse>(path);

    // meta.newest_id is the max ID across the whole result set (first page
    // is authoritative) — use it when present so since_id advances even
    // past multi-page fetches.
    if (pages === 1 && body.meta?.newest_id) newestId = body.meta.newest_id;

    const tweetsPage = Array.isArray(body.data) ? body.data : [];
    for (const tw of tweetsPage) {
      const raw = tw.created_at;
      if (typeof raw !== "string") continue;
      const t = new Date(raw);
      if (Number.isNaN(t.getTime())) continue;
      const key = dateKey(t);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      tweets++;
    }
    log(`  page ${pages}: ${tweetsPage.length} posts, days touched so far=${counts.size}`);

    nextToken = body.meta?.next_token;
    if (!nextToken) {
      stoppedAtEnd = true;
      break;
    }
  }

  if (!stoppedAtEnd) {
    throw new Error(
      `hit MAX_PAGES=${MAX_PAGES} but next_token still present — pagination stuck or user exceeded ` +
        `the 3200-tweet timeline ceiling. Investigate before re-running.`
    );
  }
  if (opts.startTime && pages >= 32) {
    // 32 pages x 100 = the 3200-tweet timeline ceiling; history older than
    // that is silently unreachable. Only matters for first-add backfills.
    log(`WARNING: fetched >=3200 posts — timeline endpoint ceiling reached, earlier history truncated`);
  }

  log(`fetch done [${tag}]: pages=${pages}, posts=${tweets}, days_touched=${counts.size}`);
  return { counts, newestId, tweets };
}

function mergeCounts(
  existing: Day[],
  fresh: Map<string, number>,
  mode: { additive: true } | { additive: false; since: string; fullBackfill: boolean }
): Day[] {
  const merged = new Map<string, number>();
  for (const d of existing) merged.set(d.date, d.count);

  if (mode.additive === false) {
    const { since, fullBackfill } = mode;
    if (fullBackfill) {
      // Wipe and replace: existing was empty or we're seeding from scratch.
      merged.clear();
    } else {
      // Overlap window: REPLACE existing counts for dates >= since.
      // Outside the overlap: untouched (never decremented).
      for (const date of [...merged.keys()]) {
        if (date >= since) merged.delete(date);
      }
    }

    for (const [date, count] of fresh) {
      // Only write inside the overlap window: start_time is UTC-midnight
      // aligned but days re-bucket to NERV_TZ, so the fetch can return
      // partial-day counts for the PT day BEFORE `since` — those must NOT
      // clobber the prior full-day total.
      if (fullBackfill || date >= since) {
        merged.set(date, count);
      }
    }
  } else {
    // since_id mode: every fetched tweet is strictly new (the API only
    // returns tweets after since_id), so add. Never decrements; deleted
    // tweets keep their count — acceptable noise for a binary ship signal.
    for (const [date, count] of fresh) {
      merged.set(date, (merged.get(date) ?? 0) + count);
    }
  }

  return [...merged.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function runSelfTest(): Promise<void> {
  // mergeCounts additive: adds to existing days, never decrements, creates
  // new days, and leaves untouched days alone.
  const base: Day[] = [
    { date: "2026-07-18", count: 3 },
    { date: "2026-07-19", count: 1 },
  ];
  const add = mergeCounts(base, new Map([["2026-07-19", 2], ["2026-07-20", 1]]), { additive: true });
  assert.deepEqual(add, [
    { date: "2026-07-18", count: 3 },
    { date: "2026-07-19", count: 3 },
    { date: "2026-07-20", count: 1 },
  ]);

  // mergeCounts overlap-replace: dates >= since replaced by fresh counts
  // (0-count days disappear), older days untouched even when fresh has a
  // (partial-day) count for them.
  const rep = mergeCounts(
    base,
    new Map([["2026-07-18", 99], ["2026-07-20", 4]]),
    { additive: false, since: "2026-07-19", fullBackfill: false }
  );
  assert.deepEqual(rep, [
    { date: "2026-07-18", count: 3 }, // pre-since: fresh 99 ignored
    { date: "2026-07-20", count: 4 },
    // 2026-07-19 replaced with "no posts" → dropped, correct: the API is
    // authoritative inside the overlap window.
  ]);

  // mergeCounts full backfill: wipes and replaces entirely.
  const full = mergeCounts(base, new Map([["2024-03-01", 7]]), {
    additive: false,
    since: "2024-01-01",
    fullBackfill: true,
  });
  assert.deepEqual(full, [{ date: "2024-03-01", count: 7 }]);

  // decideFetch mode selection.
  const withId = decideFetch({ ...emptyData("h"), last_tweet_id: "123" });
  assert.equal(withId.sinceId, "123");
  assert.equal(withId.startTime, undefined);
  const empty = decideFetch(emptyData("h"));
  assert.equal(empty.startTime, `${BACKFILL_SINCE}T00:00:00Z`);
  assert.equal(empty.fullBackfill, true);
  const migrated = decideFetch({ ...emptyData("h"), days: base });
  assert.equal(migrated.startTime, `${addDaysISO("2026-07-19", -OVERLAP_DAYS)}T00:00:00Z`);
  assert.equal(migrated.fullBackfill, false);

  console.log("x-days refresh self-test ok");
}

// ----- run ------------------------------------------------------------------

async function processUser(target: { slug: string; handle: string }): Promise<void> {
  const { slug, handle } = target;
  log(`=== ${slug} (handle=${handle}) ===`);

  const store = await loadStore();
  const existing = store[slug] ?? emptyData(handle);
  log(`loaded ${DATA_PATH}: slug=${slug}, handle=${existing.handle || "(none)"}, days=${existing.days.length}, user_id=${existing.user_id || "(none)"}, last_tweet_id=${existing.last_tweet_id || "(none)"}`);

  // Per-user failures THROW (not die/exit) so a transient X API error for
  // one user doesn't poison the whole roster's commit step. main() catches
  // and continues to the next user.
  let userId: string;
  try {
    userId = await resolveUserId(handle, existing);
  } catch (err) {
    throw new Error(`[${slug}] user lookup failed: ${err instanceof Error ? err.message : err}`);
  }

  const fetch = decideFetch(existing);
  log(`mode=${fetch.sinceId ? "since_id" : "start_time"} since_id=${fetch.sinceId ?? "-"} start_time=${fetch.startTime ?? "-"} full_backfill=${fetch.fullBackfill}`);

  let result: FetchResult;
  try {
    result = await fetchTweets(userId, { sinceId: fetch.sinceId, startTime: fetch.startTime });
  } catch (err) {
    throw new Error(`[${slug}] timeline fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  const mergedDays = result.counts.size === 0 && fetch.sinceId
    ? existing.days // quiet window: skip merge entirely, data unchanged
    : fetch.sinceId
      ? mergeCounts(existing.days, result.counts, { additive: true })
      : mergeCounts(existing.days, result.counts, {
          additive: false,
          // since in PT-day space, matching the overlap filter in mergeCounts.
          since: (fetch.startTime ?? "").slice(0, 10),
          fullBackfill: fetch.fullBackfill,
        });

  // Never advance last_tweet_id unless the fetch completed fully (it threw
  // otherwise) AND we actually saw posts. Empty since_id fetches keep the
  // old last_tweet_id — correct, there's nothing newer.
  const lastTweetId = result.newestId || existing.last_tweet_id;

  if (!fetch.fullBackfill && mergedDays.length < existing.days.length) {
    throw new Error(
      `[${slug}] merged days would shrink existing data ` +
        `(${existing.days.length} → ${mergedDays.length}) — refusing to commit. ` +
        `If this is intentional, clear ${DATA_PATH}'s ${slug}.days[] and re-run.`
    );
  }

  const existingSorted = [...existing.days].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const daysSame = JSON.stringify(existingSorted) === JSON.stringify(mergedDays);
  const idSame = existing.user_id === userId;
  const handleSame = existing.handle === handle;
  const tzSame = existing.bucketed_tz === TZ;
  const tweetIdSame = existing.last_tweet_id === lastTweetId;

  const today = dateKey(new Date());
  const todayCount = mergedDays.find((d) => d.date === today)?.count ?? 0;

  if (daysSame && idSame && handleSame && tzSame && tweetIdSame) {
    log("no data changes — skipping write");
    process.stdout.write(
      `ok slug=${slug} handle=${handle} user_id=${userId} mode=${fetch.sinceId ? "since_id" : "start_time"} ` +
        `days=${mergedDays.length} today=${today} today_count=${todayCount} skipped=1\n`
    );
    return;
  }

  const next: DataFile = {
    generated_at: new Date().toISOString(),
    user_id: userId,
    handle,
    bucketed_tz: TZ,
    last_tweet_id: lastTweetId,
    days: mergedDays,
  };

  try {
    store[slug] = next;
    await saveStore(store);
  } catch (err) {
    throw new Error(`[${slug}] write failed: ${err instanceof Error ? err.message : err}`);
  }

  process.stdout.write(
    `ok slug=${slug} handle=${handle} user_id=${userId} mode=${fetch.sinceId ? "since_id" : "start_time"} ` +
      `days=${mergedDays.length} today=${today} today_count=${todayCount} posts_fetched=${result.tweets}\n`
  );
}

async function main(): Promise<void> {
  // Build the list of targets. Priority:
  //   1. LEGACY_X_LOGIN env set + USERS_FILTER empty → single-user legacy mode
  //      (preserves the old `X_LOGIN=foo pnpm tsx scripts/refresh-x-days.ts`
  //      invocation for local testing of a one-off handle that may not even
  //      be in users.json yet). Maps the env handle to whichever roster slug
  //      shares it, or falls back to slug="env".
  //   2. Otherwise → walk users.json, optionally filtered by USERS_FILTER.
  let targets: Array<{ slug: string; handle: string }>;
  if (LEGACY_X_LOGIN && USERS_FILTER.length === 0) {
    const roster = await loadRoster();
    const match = roster.find((u) => u.xLogin === LEGACY_X_LOGIN);
    if (match) {
      log(`legacy single-user mode: X_LOGIN=${LEGACY_X_LOGIN} → slug=${match.slug}`);
      targets = [{ slug: match.slug, handle: LEGACY_X_LOGIN }];
    } else {
      log(`legacy single-user mode: X_LOGIN=${LEGACY_X_LOGIN} not in roster, using slug="env"`);
      targets = [{ slug: "env", handle: LEGACY_X_LOGIN }];
    }
  } else {
    const roster = await loadRoster();
    const filtered = USERS_FILTER.length
      ? roster.filter((u) => USERS_FILTER.includes(u.slug))
      : roster;
    if (filtered.length === 0) {
      die(
        2,
        `no users to refresh (USERS_FILTER=${USERS_FILTER.join(",")} matched none of ${roster.map((u) => u.slug).join(",")})`
      );
    }
    targets = filtered.map((u) => ({ slug: u.slug, handle: u.xLogin }));
  }

  // Sequential: app-level rate limits are shared across users and n=2 is
  // fast (~2 requests). Revisit bounded parallelism if the roster grows
  // past ~10 (the timeline endpoint allows ~5 req/15min/app on low tiers;
  // hourly x 2 users x 1 page fits with huge headroom).
  //
  // Partial-success policy: a per-user failure throws but main() catches
  // and continues to the next user. Only when ALL users fail do we exit
  // non-zero, which is what blocks the workflow's commit step. This way a
  // single transient X API error doesn't gate everyone else's refresh.
  const failures: Array<{ slug: string; err: unknown }> = [];
  for (const t of targets) {
    try {
      await processUser(t);
    } catch (err) {
      failures.push({ slug: t.slug, err });
      log(`[${t.slug}] FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failures.length === targets.length) {
    die(
      1,
      `all ${targets.length} user(s) failed; nothing to commit. ` +
        `Last error: ${failures[failures.length - 1]?.err}`
    );
  }
  if (failures.length > 0) {
    // Partial success: print a clear summary line. We exit 0 so the
    // workflow's commit step still runs on the survivors' data.
    process.stdout.write(
      `partial slugs_failed=${failures.length}/${targets.length} failed=${failures.map((f) => f.slug).join(",")}\n`
    );
  }
}

// No top-level await (root package is CJS): dispatch async entrypoints here.
if (SELF_TEST) {
  runSelfTest().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(2);
    }
  );
} else {
  main().catch((err) => {
    die(2, `unhandled: ${err instanceof Error ? err.stack ?? err.message : err}`);
  });
}
