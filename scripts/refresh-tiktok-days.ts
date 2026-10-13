#!/usr/bin/env tsx
/** Refresh public TikTok activity from Apify's profile scraper. */

import assert from "node:assert/strict";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Day = { date: string; count: number };
type DataFile = { generated_at: string; handle: string; bucketed_tz: string; days: Day[] };
type Store = Record<string, DataFile>;
type User = { slug: string; tiktokLogin?: string };
type ApifyPost = { id?: unknown; uploadedAt?: unknown; channel?: { username?: unknown } };

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usersPath = resolve(root, "apps/web/src/config/users.json");
const dataPath = resolve(root, "apps/web/src/data/tiktok-days-by-slug.json");
const token = process.env.APIFY_TOKEN?.trim() ?? "";
const tz = process.env.NERV_TZ?.trim() || "America/Los_Angeles";
const maxItems = 100;
const actor = "apidojo~tiktok-profile-scraper";

const log = (message: string) => process.stderr.write(`[refresh-tiktok-days] ${message}\n`);
const die = (message: string): never => {
  process.stderr.write(`[refresh-tiktok-days] FATAL: ${message}\n`);
  process.exit(1);
};

function dateKey(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function isDay(value: unknown): value is Day {
  if (!value || typeof value !== "object") return false;
  const { date, count } = value as Partial<Day>;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof count === "number" && count >= 0;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadUsers(): Promise<User[]> {
  const parsed = await readJson(usersPath) as { users?: unknown };
  if (!Array.isArray(parsed.users)) die(`${usersPath} must contain users[]`);
  return parsed.users.filter((user): user is User =>
    Boolean(user && typeof user === "object" && typeof (user as User).slug === "string")
  );
}

async function loadStore(): Promise<Store> {
  try {
    const parsed = await readJson(dataPath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) die(`${dataPath} must be an object`);
    return parsed as Store;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function saveStore(store: Store): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(store).sort(([a], [b]) => a.localeCompare(b)).map(([slug, data]) => [
      slug,
      { ...data, days: [...data.days].sort((a, b) => a.date.localeCompare(b.date)) },
    ])
  );
  const tmp = `${dataPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
  await rename(tmp, dataPath);
}

async function fetchPosts(handles: string[]): Promise<ApifyPost[]> {
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usernames: handles, maxItems }),
    }
  );
  if (!response.ok) die(`Apify ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) die("Apify returned a non-array dataset");
  return body as ApifyPost[];
}

function countsForHandle(posts: ApifyPost[], handle: string): Day[] {
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  for (const post of posts) {
    if (typeof post.id !== "string" || ids.has(post.id) || typeof post.uploadedAt !== "number") continue;
    if (typeof post.channel?.username === "string" && post.channel.username.toLowerCase() !== handle.toLowerCase()) continue;
    ids.add(post.id);
    const date = dateKey(post.uploadedAt);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

function mergeDays(existing: Day[], fresh: Day[]): Day[] {
  const merged = new Map(existing.filter(isDay).map((day) => [day.date, day.count]));
  const since = fresh[0]?.date;
  if (since) for (const date of merged.keys()) if (date >= since) merged.delete(date);
  for (const day of fresh) merged.set(day.date, day.count);
  return [...merged].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

async function main(): Promise<void> {
  if (process.env.SELF_TEST === "1") return selfTest();
  const targets = (await loadUsers()).filter((user) => user.tiktokLogin?.trim());
  if (!targets.length) return log("no users with tiktokLogin configured; nothing to refresh");
  if (!token) die("APIFY_TOKEN is required when a tiktokLogin is configured");

  const posts = await fetchPosts(targets.map((user) => user.tiktokLogin!.trim().replace(/^@/, "")));
  const store = await loadStore();
  for (const { slug, tiktokLogin } of targets) {
    const handle = tiktokLogin!.trim().replace(/^@/, "");
    const fresh = countsForHandle(posts, handle);
    if (!fresh.length) die(`Apify returned no valid posts for @${handle}`);
    const existing = store[slug]?.days ?? [];
    store[slug] = { generated_at: new Date().toISOString(), handle, bucketed_tz: tz, days: mergeDays(existing, fresh) };
    log(`${slug}: ${fresh.length} days from ${posts.length} posts`);
  }
  await saveStore(store);
}

function selfTest(): void {
  assert.match(dateKey(1_752_000_000), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(countsForHandle([
    { id: "one", uploadedAt: 1_752_000_000, channel: { username: "subby" } },
    { id: "one", uploadedAt: 1_752_000_000, channel: { username: "subby" } },
    { id: "two", uploadedAt: 1_752_000_000, channel: { username: "other" } },
  ], "subby"), [{ date: dateKey(1_752_000_000), count: 1 }]);
  assert.deepEqual(mergeDays([{ date: "2026-01-01", count: 1 }, { date: "2026-01-02", count: 1 }], [{ date: "2026-01-02", count: 2 }]), [{ date: "2026-01-01", count: 1 }, { date: "2026-01-02", count: 2 }]);
  console.log("tiktok refresh self-test ok");
}

main().catch((error) => die(error instanceof Error ? error.message : String(error)));
