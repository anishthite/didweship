#!/usr/bin/env tsx
/**
 * refresh-tiktok-days.ts — refresh apps/web/src/data/tiktok-days-by-slug.json.
 *
 * Uses TikTok Display API /v2/video/list/ for connected accounts. No
 * tiktokLogin configured = clean skip; once a roster entry opts into TikTok,
 * its token and expected open_id are required.
 */

import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

type Day = { date: string; count: number };

type DataFile = {
  generated_at: string;
  handle: string;
  bucketed_tz: string;
  days: Day[];
};

type DataBySlugFile = Record<string, DataFile>;

type RosterUser = {
  slug: string;
  displayName: string;
  githubLogin: string;
  xLogin: string;
  tiktokLogin?: string;
};

type TiktokVideo = {
  id?: string;
  create_time?: number;
};

type VideoListResponse = {
  data?: {
    videos?: TiktokVideo[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  message?: string;
  log_id?: string;
};

type UserInfoResponse = {
  data?: {
    user?: {
      open_id?: string;
      display_name?: string;
    };
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const USERS_PATH = resolve(REPO_ROOT, "apps/web/src/config/users.json");
const DATA_PATH = resolve(REPO_ROOT, "apps/web/src/data/tiktok-days-by-slug.json");
const API_BASE = "https://open.tiktokapis.com";
const OVERLAP_DAYS = 2;
const MAX_PAGES = 50;

const log = (msg: string) => process.stderr.write(`[refresh-tiktok-days] ${msg}\n`);

function die(code: 1 | 2, msg: string): never {
  process.stderr.write(`[refresh-tiktok-days] FATAL: ${msg}\n`);
  process.exit(code);
}

const SELF_TEST = process.env.SELF_TEST === "1";
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY?.trim() ?? "";
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET?.trim() ?? "";
const ACCESS_TOKENS_JSON = process.env.TIKTOK_ACCESS_TOKENS_JSON?.trim() ?? "";
const REFRESH_TOKENS_JSON = process.env.TIKTOK_REFRESH_TOKENS_JSON?.trim() ?? "";
const OPEN_IDS_JSON = process.env.TIKTOK_OPEN_IDS_JSON?.trim() ?? "";
const LEGACY_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN?.trim() ?? "";
const USERS_FILTER = (process.env.USERS_FILTER?.trim() || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TZ = process.env.NERV_TZ?.trim() || "America/Los_Angeles";
const BACKFILL_SINCE = process.env.BACKFILL_SINCE?.trim() || "2024-01-01";

if (SELF_TEST) {
  runSelfTest();
  process.exit(0);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(BACKFILL_SINCE)) {
  die(2, `BACKFILL_SINCE must be YYYY-MM-DD, got: ${BACKFILL_SINCE}`);
}

const ACCESS_TOKENS = parseTokenMap(ACCESS_TOKENS_JSON, "TIKTOK_ACCESS_TOKENS_JSON");
const REFRESH_TOKENS = parseTokenMap(REFRESH_TOKENS_JSON, "TIKTOK_REFRESH_TOKENS_JSON");
const OPEN_IDS = parseTokenMap(OPEN_IDS_JSON, "TIKTOK_OPEN_IDS_JSON");

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

function envSlug(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function parseTokenMap(raw: string, name: string): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    die(2, `${name} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    die(2, `${name} must be a JSON object like {"anish":"value"}`);
  }
  const out: Record<string, string> = {};
  for (const [slug, token] of Object.entries(parsed)) {
    if (typeof token === "string" && token.trim()) out[slug] = token.trim();
  }
  return out;
}

function safeApiError(
  error: { code?: string; message?: string; log_id?: string } | undefined,
  fallback = "unknown_error"
): string {
  const code = error?.code || fallback;
  const message = (error?.message || "").slice(0, 160);
  const logId = error?.log_id || "";
  return [`code=${code}`, message ? `message=${message}` : "", logId ? `log_id=${logId}` : ""]
    .filter(Boolean)
    .join(" ");
}

function safeOAuthError(parsed: TokenResponse): string {
  const code = parsed.error || "oauth_error";
  const message = (parsed.error_description || parsed.message || "").slice(0, 160);
  const logId = parsed.log_id || "";
  return [`code=${code}`, message ? `message=${message}` : "", logId ? `log_id=${logId}` : ""]
    .filter(Boolean)
    .join(" ");
}

function isValidDayList(v: unknown): v is Day[] {
  if (!Array.isArray(v)) return false;
  for (const item of v) {
    if (!item || typeof item !== "object") return false;
    const d = (item as { date?: unknown }).date;
    const c = (item as { count?: unknown }).count;
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return false;
  }
  return true;
}

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
        ...(typeof o.tiktokLogin === "string" && o.tiktokLogin.trim()
          ? { tiktokLogin: o.tiktokLogin.replace(/^@/, "") }
          : {}),
      });
    }
  }
  if (out.length === 0) die(2, `${USERS_PATH}: no valid user entries`);
  return out;
}

function emptyData(handle: string): DataFile {
  return {
    generated_at: "1970-01-01T00:00:00.000Z",
    handle,
    bucketed_tz: "",
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
    handle: typeof obj.handle === "string" ? obj.handle : "",
    bucketed_tz: typeof obj.bucketed_tz === "string" ? obj.bucketed_tz : "",
    days,
  };
}

async function loadStore(): Promise<DataBySlugFile> {
  let raw: string;
  try {
    raw = await readFile(DATA_PATH, "utf8");
  } catch {
    return {};
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
  const tmp = DATA_PATH + ".tmp";
  await writeFile(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
  await rename(tmp, DATA_PATH);
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  if (!CLIENT_KEY || !CLIENT_SECRET) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are required for refresh tokens");
  }
  const body = new URLSearchParams({
    client_key: CLIENT_KEY,
    client_secret: CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(`${API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });
  const text = await res.text();
  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`token refresh returned non-JSON HTTP ${res.status}`);
  }
  if (!res.ok || parsed.error) {
    throw new Error(`token refresh failed HTTP ${res.status}: ${safeOAuthError(parsed)}`);
  }
  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw new Error(`token refresh returned no access_token HTTP ${res.status}`);
  }
  return parsed;
}

async function tokenForSlug(slug: string, singleTarget: boolean): Promise<string> {
  const suffix = envSlug(slug);
  const refreshToken =
    process.env[`TIKTOK_REFRESH_TOKEN_${suffix}`]?.trim() || REFRESH_TOKENS[slug] || "";
  if (refreshToken) {
    const refreshed = await refreshAccessToken(refreshToken);
    if (refreshed.refresh_token && refreshed.refresh_token !== refreshToken) {
      throw new Error(
        `refresh token rotated for slug=${slug}; update TIKTOK_REFRESH_TOKENS_JSON before rerunning`
      );
    }
    return refreshed.access_token!;
  }

  return (
    process.env[`TIKTOK_ACCESS_TOKEN_${suffix}`]?.trim() ||
    ACCESS_TOKENS[slug] ||
    (singleTarget ? LEGACY_ACCESS_TOKEN : "")
  );
}

function expectedOpenIdForSlug(slug: string, singleTarget: boolean): string {
  const suffix = envSlug(slug);
  return (
    process.env[`TIKTOK_OPEN_ID_${suffix}`]?.trim() ||
    OPEN_IDS[slug] ||
    (singleTarget ? process.env.TIKTOK_OPEN_ID?.trim() || "" : "")
  );
}

async function fetchConnectedOpenId(token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/v2/user/info/?fields=open_id,display_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let parsed: UserInfoResponse;
  try {
    parsed = JSON.parse(text) as UserInfoResponse;
  } catch {
    throw new Error(`user.info returned non-JSON HTTP ${res.status}`);
  }
  const code = parsed.error?.code ?? "ok";
  if (!res.ok || (code && code !== "ok")) {
    throw new Error(`user.info failed HTTP ${res.status}: ${safeApiError(parsed.error)}`);
  }
  const openId = parsed.data?.user?.open_id;
  if (typeof openId !== "string" || !openId) {
    throw new Error(`user.info returned no open_id HTTP ${res.status}`);
  }
  return openId;
}

async function assertTokenMatchesSlug(
  token: string,
  slug: string,
  handle: string,
  singleTarget: boolean
): Promise<void> {
  const expectedOpenId = expectedOpenIdForSlug(slug, singleTarget);
  if (!expectedOpenId) {
    throw new Error(
      `missing TIKTOK_OPEN_IDS_JSON entry for slug=${slug}; refusing to attribute token to @${handle}`
    );
  }
  const actualOpenId = await fetchConnectedOpenId(token);
  if (actualOpenId !== expectedOpenId) {
    throw new Error(`token open_id mismatch for slug=${slug}; refusing to write TikTok days`);
  }
}

function decideSince(existing: DataFile): { since: string; fullBackfill: boolean } {
  if (existing.days.length === 0) return { since: BACKFILL_SINCE, fullBackfill: true };
  const maxDate = existing.days.reduce((acc, d) => (d.date > acc ? d.date : acc), existing.days[0]!.date);
  return { since: addDaysISO(maxDate, -OVERLAP_DAYS), fullBackfill: false };
}

async function fetchVideoDayCounts(token: string, since: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const seenIds = new Set<string>();
  let cursor: number | undefined;
  let pages = 0;
  let stopped = false;

  while (pages < MAX_PAGES && !stopped) {
    pages++;
    const body: { max_count: number; cursor?: number } = { max_count: 20 };
    if (cursor !== undefined) body.cursor = cursor;
    log(`page ${pages}: POST /v2/video/list cursor=${cursor ?? "latest"}`);

    const res = await fetch(
      `${API_BASE}/v2/video/list/?fields=id,create_time`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    const text = await res.text();
    let parsed: VideoListResponse;
    try {
      parsed = JSON.parse(text) as VideoListResponse;
    } catch {
      throw new Error(`video.list returned non-JSON HTTP ${res.status}`);
    }
    const code = parsed.error?.code ?? "ok";
    if (!res.ok || (code && code !== "ok")) {
      throw new Error(`video.list failed HTTP ${res.status}: ${safeApiError(parsed.error, code)}`);
    }

    const videos = parsed.data?.videos;
    if (!Array.isArray(videos)) {
      throw new Error(`video.list returned no data.videos array HTTP ${res.status}`);
    }

    let countedOnPage = 0;
    for (const v of videos) {
      if (v.id && seenIds.has(v.id)) continue;
      if (v.id) seenIds.add(v.id);
      if (typeof v.create_time !== "number" || !Number.isFinite(v.create_time)) continue;
      const key = dateKey(new Date(v.create_time * 1000));
      if (key < since) {
        stopped = true;
        continue;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      countedOnPage++;
    }
    log(`  videos=${videos.length}, counted=${countedOnPage}, days_touched=${counts.size}`);

    const nextCursor = parsed.data?.cursor;
    if (!parsed.data?.has_more || typeof nextCursor !== "number" || nextCursor === cursor) {
      stopped = true;
    } else {
      cursor = nextCursor;
    }
  }

  if (!stopped) {
    throw new Error(`hit MAX_PAGES=${MAX_PAGES} before TikTok pagination ended`);
  }
  return counts;
}

function mergeCounts(existing: Day[], fresh: Map<string, number>, since: string, fullBackfill: boolean): Day[] {
  const merged = new Map<string, number>();
  for (const d of existing) merged.set(d.date, d.count);

  if (fullBackfill) {
    merged.clear();
  } else {
    for (const date of [...merged.keys()]) {
      if (date >= since) merged.delete(date);
    }
  }
  for (const [date, count] of fresh) {
    if (fullBackfill || date >= since) merged.set(date, count);
  }

  return [...merged.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function processUser(target: { slug: string; handle: string }, singleTarget: boolean): Promise<"updated"> {
  const { slug, handle } = target;
  log(`=== ${slug} (tiktok=${handle}) ===`);
  const token = await tokenForSlug(slug, singleTarget);
  if (!token) {
    throw new Error(`no TikTok token configured for slug=${slug}`);
  }
  await assertTokenMatchesSlug(token, slug, handle, singleTarget);

  const store = await loadStore();
  const existing = store[slug] ?? emptyData(handle);
  const { since, fullBackfill } = decideSince(existing);
  log(`since=${since}, full_backfill=${fullBackfill}`);

  const counts = await fetchVideoDayCounts(token, since);
  const mergedDays = mergeCounts(existing.days, counts, since, fullBackfill);
  if (!fullBackfill && mergedDays.length < existing.days.length) {
    throw new Error(
      `[${slug}] merged days would shrink existing data (${existing.days.length} → ${mergedDays.length})`
    );
  }

  const existingSorted = [...existing.days].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const daysSame = JSON.stringify(existingSorted) === JSON.stringify(mergedDays);
  const handleSame = existing.handle === handle;
  const tzSame = existing.bucketed_tz === TZ;
  if (daysSame && handleSame && tzSame) {
    log("no data changes — skipping write");
    process.stdout.write(`ok slug=${slug} handle=${handle} since=${since} days=${mergedDays.length} skipped=1\n`);
    return "updated";
  }

  store[slug] = {
    generated_at: new Date().toISOString(),
    handle,
    bucketed_tz: TZ,
    days: mergedDays,
  };
  await saveStore(store);
  process.stdout.write(`ok slug=${slug} handle=${handle} since=${since} days=${mergedDays.length}\n`);
  return "updated";
}

async function main(): Promise<void> {
  const roster = await loadRoster();
  const wanted = USERS_FILTER.length
    ? roster.filter((u) => USERS_FILTER.includes(u.slug))
    : roster;
  const targets = wanted
    .filter((u) => u.tiktokLogin)
    .map((u) => ({ slug: u.slug, handle: u.tiktokLogin! }));

  if (targets.length === 0) {
    log("no users with tiktokLogin configured; nothing to refresh");
    return;
  }

  const failures: Array<{ slug: string; err: unknown }> = [];
  let updated = 0;
  for (const t of targets) {
    try {
      const result = await processUser(t, targets.length === 1);
      if (result === "updated") updated++;
    } catch (err) {
      failures.push({ slug: t.slug, err });
      log(`[${t.slug}] FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (failures.length > 0) {
    die(
      1,
      `configured TikTok refresh failed for ${failures.length}/${targets.length} slug(s): ` +
        `${failures.map((f) => f.slug).join(",")}. No partial commit should be made.`
    );
  }
  if (updated === 0) {
    log("no TikTok data changes");
  }
}

function runSelfTest(): void {
  assert.deepEqual(
    mergeCounts(
      [
        { date: "2026-07-18", count: 1 },
        { date: "2026-07-19", count: 1 },
        { date: "2026-07-20", count: 1 },
      ],
      new Map([["2026-07-20", 2]]),
      "2026-07-19",
      false
    ),
    [
      { date: "2026-07-18", count: 1 },
      { date: "2026-07-20", count: 2 },
    ]
  );
  assert.deepEqual(mergeCounts([], new Map([["2026-07-20", 1]]), "2026-01-01", true), [
    { date: "2026-07-20", count: 1 },
  ]);
  console.log("tiktok refresh self-test ok");
}

main().catch((err) => {
  die(2, `unhandled: ${err instanceof Error ? err.stack ?? err.message : err}`);
});
