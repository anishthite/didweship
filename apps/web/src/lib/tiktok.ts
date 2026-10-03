import "server-only";
import { fillMissingDays, type Day } from "./streak";
import tiktokDaysBySlug from "../data/tiktok-days-by-slug.json";

/** TikTok source — bundled static JSON, refreshed by GitHub Actions. */

type TiktokDaysFile = {
  days?: unknown;
  generated_at?: unknown;
  handle?: unknown;
  bucketed_tz?: unknown;
};

const TIKTOK_DAYS_BY_SLUG = tiktokDaysBySlug as Record<string, TiktokDaysFile | undefined>;
const bucketedTzLegacyWarned = new Set<string>();

export class TiktokFeedOfflineError extends Error {
  attempts: Array<{ host: string; reason: string }>;
  constructor(attempts: Array<{ host: string; reason: string }>) {
    super(`TikTok feed offline; bundled JSON unusable (${attempts.length})`);
    this.name = "TiktokFeedOfflineError";
    this.attempts = attempts;
  }
}

export type FetchTiktokOpts = {
  slug: string;
  login: string;
  tz: string;
  from: string;
  to: string;
};

export async function fetchTiktokDays(opts: FetchTiktokOpts): Promise<Day[]> {
  const { slug, login, from, to } = opts;
  if (!login) {
    throw new Error(
      `TikTok fetch: tiktokLogin is empty for slug=${slug}. Configure it in apps/web/src/config/users.json.`
    );
  }
  if (to < from) {
    throw new Error(`fetchTiktokDays: to (${to}) is before from (${from})`);
  }

  const file = TIKTOK_DAYS_BY_SLUG[slug];
  if (!file) {
    throw new TiktokFeedOfflineError([
      { host: "bundled-json", reason: `no bundled tiktok-days data for slug=${slug}` },
    ]);
  }
  const rawDays = file.days;
  if (!Array.isArray(rawDays)) {
    throw new TiktokFeedOfflineError([
      {
        host: "bundled-json",
        reason: `tiktok-days-by-slug.json missing/invalid days[] for slug=${slug}`,
      },
    ]);
  }

  const bucketedTz = typeof file.bucketed_tz === "string" ? file.bucketed_tz : "";
  if (bucketedTz) {
    if (bucketedTz !== opts.tz) {
      throw new TiktokFeedOfflineError([
        {
          host: "bundled-json",
          reason: `tz mismatch for slug=${slug}: file=${bucketedTz}, runtime=${opts.tz}`,
        },
      ]);
    }
  } else if (!bucketedTzLegacyWarned.has(slug)) {
    bucketedTzLegacyWarned.add(slug);
    console.warn(
      `[tiktok] tiktok-days-by-slug.json has no \`bucketed_tz\` for slug=${slug} — ` +
        "cannot validate tz consistency. Re-run scripts/refresh-tiktok-days.ts."
    );
  }

  let shapeOk = 0;
  const rows: Array<{ date: string; count: number }> = [];
  for (const item of rawDays) {
    if (!item || typeof item !== "object") continue;
    const d = (item as { date?: unknown }).date;
    const c = (item as { count?: unknown }).count;
    if (typeof d !== "string" || typeof c !== "number") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    shapeOk++;
    if (d < from || d > to) continue;
    rows.push({ date: d, count: c });
  }

  // Empty days[] is valid for a connected TikTok account with no public videos.
  if (rawDays.length > 0 && shapeOk === 0) {
    throw new TiktokFeedOfflineError([
      {
        host: "bundled-json",
        reason: `all days[] entries failed shape validation for slug=${slug}`,
      },
    ]);
  }

  return fillMissingDays(rows, from, to);
}
