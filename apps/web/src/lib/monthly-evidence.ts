import "server-only";

import { fetchTwitterDays, TwitterFeedOfflineError } from "./twitter";
import type { UserConfig } from "@/config/users";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const GITHUB_REST = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type EvidenceState = "exact" | "partial" | "unavailable";

export type EvidenceMetric = {
  value: number | null;
  state: EvidenceState;
  source: string;
  note?: string;
};

export type EvidenceRepository = {
  name: string;
  url: string;
};

export type MonthlyEvidence = {
  account: { github: string; x: string };
  generatedAt: string;
  range: { month: string; from: string; to: string };
  github: {
    connected: boolean;
    source: string;
    days: Array<{ date: string; count: number }>;
    repositories: EvidenceRepository[];
    metrics: {
      contributions: EvidenceMetric;
      activeDays: EvidenceMetric;
      commits: EvidenceMetric;
      commitRepositories: EvidenceMetric;
      pullRequestsOpened: EvidenceMetric;
      pullRequestsMerged: EvidenceMetric;
      issuesOpened: EvidenceMetric;
      reviews: EvidenceMetric;
      repositoriesCreated: EvidenceMetric;
      releases: EvidenceMetric;
      deployments: EvidenceMetric;
    };
    warnings: string[];
  };
  x: {
    connected: boolean;
    source: string;
    days: Array<{ date: string; count: number }>;
    metrics: {
      observedActiveDays: EvidenceMetric;
      postsAndReplies: EvidenceMetric;
      views: EvidenceMetric;
      likes: EvidenceMetric;
      reposts: EvidenceMetric;
      media: EvidenceMetric;
    };
    warnings: string[];
  };
};

type GraphqlResponse = {
  data?: {
    viewer?: { login: string };
    user?: {
      contributionsCollection?: {
        totalCommitContributions: number;
        totalIssueContributions: number;
        totalPullRequestContributions: number;
        totalPullRequestReviewContributions: number;
        totalRepositoriesWithContributedCommits: number;
        contributionCalendar: {
          totalContributions: number;
          weeks: Array<{
            contributionDays: Array<{ date: string; contributionCount: number }>;
          }>;
        };
      } | null;
    } | null;
  };
  errors?: Array<{ message: string }>;
};

type SearchResponse = {
  total_count?: number;
  incomplete_results?: boolean;
  items?: Array<{
    repository?: { full_name?: string; html_url?: string };
  }>;
};

type RepositoryResponse = {
  created_at?: string;
  full_name?: string;
  html_url?: string;
};

type ReleaseResponse = { published_at?: string | null };

const CONTRIBUTION_QUERY = /* GraphQL */ `
  query MonthlyEvidence($login: String!, $from: DateTime!, $to: DateTime!) {
    viewer { login }
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoriesWithContributedCommits
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

function unavailable(source: string, note?: string): EvidenceMetric {
  return { value: null, state: "unavailable", source, ...(note ? { note } : {}) };
}

function exact(value: number, source: string, note?: string): EvidenceMetric {
  return { value, state: "exact", source, ...(note ? { note } : {}) };
}

function partial(value: number, source: string, note: string): EvidenceMetric {
  return { value, state: "partial", source, note };
}

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("month must be YYYY-MM");
  }
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const end = new Date(next.getTime() - 86_400_000);
  const endMoment = new Date(next.getTime() - 1);
  const isoDate = (date: Date) => date.toISOString().slice(0, 10);
  return {
    from: isoDate(start),
    to: isoDate(end),
    fromIso: start.toISOString(),
    toIso: endMoment.toISOString(),
  };
}

function githubHeaders(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "didweship-monthly-grader",
    ...extra,
  };
}

async function githubJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_REST}${path}`, {
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub REST ${res.status} for ${path}: ${body.slice(0, 160)}`);
  }
  return res.json() as Promise<T>;
}

async function contributionData(login: string, token: string, fromIso: string, nextIso: string) {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: githubHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      query: CONTRIBUTION_QUERY,
      variables: { login, from: fromIso, to: nextIso },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub GraphQL ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as GraphqlResponse;
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((error) => error.message).join("; ")}`);
  }
  const collection = json.data?.user?.contributionsCollection;
  if (!collection) throw new Error(`No contribution collection returned for ${login}`);
  return { collection, viewerLogin: json.data?.viewer?.login ?? "" };
}

async function searchGithub(query: string, token: string) {
  return githubJson<SearchResponse>(`/search/issues?${new URLSearchParams({ q: query, per_page: "1" })}`, token);
}

async function searchCommits(login: string, from: string, to: string, token: string) {
  const query = `author:${login} author-date:${from}..${to}`;
  return githubJson<SearchResponse>(`/search/commits?${new URLSearchParams({ q: query, per_page: "100" })}`, token);
}

async function reposCreatedInMonth(
  login: string,
  viewerLogin: string,
  from: string,
  to: string,
  token: string
): Promise<{ repositories: EvidenceRepository[]; complete: boolean; warning?: string }> {
  const isViewer = viewerLogin.toLowerCase() === login.toLowerCase();
  const params = new URLSearchParams({
    sort: "created",
    direction: "desc",
    per_page: "100",
    ...(isViewer ? { affiliation: "owner" } : { type: "owner" }),
  });
  const base = isViewer ? "/user/repos" : `/users/${encodeURIComponent(login)}/repos`;
  const repositories: EvidenceRepository[] = [];

  // Repositories are newest-first. Once a page contains a repository from
  // before the requested month, no later page can contain a match.
  for (let page = 1; page <= 10; page++) {
    const rows = await githubJson<RepositoryResponse[]>(`${base}?${params}&page=${page}`, token);
    if (!rows.length) return { repositories, complete: true };
    let reachedOlderRepository = false;
    for (const repo of rows) {
      const created = repo.created_at?.slice(0, 10);
      if (!created) continue;
      if (created >= from && created <= to && repo.full_name && repo.html_url) {
        repositories.push({ name: repo.full_name, url: repo.html_url });
      }
      if (created < from) reachedOlderRepository = true;
    }
    if (reachedOlderRepository) return { repositories, complete: true };
  }
  return {
    repositories,
    complete: false,
    warning: "Repository history exceeded the 1,000-item collection limit; creation count is a lower bound.",
  };
}

function stateFromSearch(result: SearchResponse, source: string, limitNote: string): EvidenceMetric {
  const value = typeof result.total_count === "number" ? result.total_count : null;
  if (value === null) return unavailable(source, "GitHub did not return a result count.");
  if (result.incomplete_results || value >= 1000) return partial(value, source, limitNote);
  return exact(value, source);
}

async function releasesForRepositories(
  repositories: EvidenceRepository[],
  from: string,
  to: string,
  token: string
): Promise<EvidenceMetric> {
  if (!repositories.length) return exact(0, "GitHub REST releases", "No active repositories were identified by commit search.");
  const capped = repositories.slice(0, 25);
  const results = await Promise.allSettled(
    capped.map((repo) =>
      githubJson<ReleaseResponse[]>(`/repos/${repo.name}/releases?per_page=100`, token)
    )
  );
  let count = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "rejected") {
      failed++;
      continue;
    }
    count += result.value.filter((release) => {
      const published = release.published_at?.slice(0, 10);
      return Boolean(published && published >= from && published <= to);
    }).length;
  }
  const coverageNote = `Checked releases in ${capped.length} ${capped.length === 1 ? "repository" : "repositories"} identified by the month’s commit search.`;
  if (repositories.length > capped.length || failed) {
    return partial(count, "GitHub REST releases", `${coverageNote} ${failed ? `${failed} repository lookups failed.` : "More active repositories were omitted after the 25-repository cap."}`);
  }
  return exact(count, "GitHub REST releases", coverageNote);
}

function emptyGithub(source: string, warning: string): MonthlyEvidence["github"] {
  const unavailableMetric = () => unavailable(source, warning);
  return {
    connected: false,
    source,
    days: [],
    repositories: [],
    metrics: {
      contributions: unavailableMetric(),
      activeDays: unavailableMetric(),
      commits: unavailableMetric(),
      commitRepositories: unavailableMetric(),
      pullRequestsOpened: unavailableMetric(),
      pullRequestsMerged: unavailableMetric(),
      issuesOpened: unavailableMetric(),
      reviews: unavailableMetric(),
      repositoriesCreated: unavailableMetric(),
      releases: unavailableMetric(),
      deployments: unavailableMetric(),
    },
    warnings: [warning],
  };
}

async function getGithubEvidence(login: string, month: string, token: string): Promise<MonthlyEvidence["github"]> {
  const range = monthRange(month);
  if (!token) {
    return emptyGithub("GitHub API", "GITHUB_TOKEN is not configured on this deployment.");
  }

  try {
    const { collection, viewerLogin } = await contributionData(login, token, range.fromIso, range.toIso);
    const days = collection.contributionCalendar.weeks
      .flatMap((week) => week.contributionDays)
      .filter((day) => day.date >= range.from && day.date <= range.to)
      .map((day) => ({ date: day.date, count: day.contributionCount }));
    const activeDays = days.filter((day) => day.count > 0).length;

    const [commits, openedPrs, mergedPrs, createdRepos] = await Promise.all([
      searchCommits(login, range.from, range.to, token),
      searchGithub(`author:${login} is:pr created:${range.from}..${range.to}`, token),
      searchGithub(`author:${login} is:pr is:merged merged:${range.from}..${range.to}`, token),
      reposCreatedInMonth(login, viewerLogin, range.from, range.to, token),
    ]);

    const repositories = new Map<string, EvidenceRepository>();
    for (const item of commits.items ?? []) {
      const name = item.repository?.full_name;
      const url = item.repository?.html_url;
      if (name && url) repositories.set(name, { name, url });
    }
    for (const repo of createdRepos.repositories) repositories.set(repo.name, repo);
    const releaseMetric = await releasesForRepositories([...repositories.values()], range.from, range.to, token);
    const commitMetric = stateFromSearch(
      commits,
      "GitHub commit search",
      "GitHub commit search exceeded its exact-result limit; this is a lower bound."
    );
    const repoMetric = createdRepos.complete
      ? exact(createdRepos.repositories.length, "GitHub repository list")
      : partial(createdRepos.repositories.length, "GitHub repository list", createdRepos.warning ?? "Repository history was truncated.");

    return {
      connected: true,
      source: viewerLogin.toLowerCase() === login.toLowerCase()
        ? "Authenticated GitHub account"
        : "GitHub profile (public repository fallback)",
      days,
      repositories: [...repositories.values()].slice(0, 25),
      metrics: {
        contributions: exact(days.reduce((total, day) => total + day.count, 0), "GitHub contribution calendar"),
        activeDays: exact(activeDays, "GitHub contribution calendar"),
        commits: commitMetric,
        commitRepositories: exact(collection.totalRepositoriesWithContributedCommits, "GitHub contributions collection"),
        pullRequestsOpened: stateFromSearch(
          openedPrs,
          "GitHub pull request search",
          "GitHub search exceeded its exact-result limit; this is a lower bound."
        ),
        pullRequestsMerged: stateFromSearch(
          mergedPrs,
          "GitHub pull request search",
          "GitHub search exceeded its exact-result limit; this is a lower bound."
        ),
        issuesOpened: exact(collection.totalIssueContributions, "GitHub contributions collection"),
        reviews: exact(collection.totalPullRequestReviewContributions, "GitHub contributions collection"),
        repositoriesCreated: repoMetric,
        releases: releaseMetric,
        deployments: unavailable("GitHub deployments", "Deployment evidence needs a deployment provider or repository-level deployment collection."),
      },
      warnings: [
        ...(createdRepos.warning ? [createdRepos.warning] : []),
        ...(viewerLogin.toLowerCase() === login.toLowerCase() ? [] : ["The configured token belongs to another account; repository creation evidence is limited to public repositories."]),
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyGithub("GitHub API", message);
  }
}

async function getXEvidence(user: UserConfig, month: string): Promise<MonthlyEvidence["x"]> {
  const range = monthRange(month);
  const source = "Bundled X day-activity feed";
  try {
    const days = await fetchTwitterDays({
      slug: user.slug,
      login: user.xLogin,
      tz: process.env.NERV_TZ ?? "America/Los_Angeles",
      from: range.from,
      to: range.to,
    });
    const observedActiveDays = days.filter((day) => day.count > 0).length;
    return {
      connected: true,
      source,
      days,
      metrics: {
        observedActiveDays: exact(observedActiveDays, source, "Daily activity is available; day counts may be a minimum when the refresh runs in latest-only mode."),
        postsAndReplies: unavailable(source, "The bundled feed does not preserve complete post/reply totals."),
        views: unavailable(source, "X view data is not in the bundled feed."),
        likes: unavailable(source, "X like data is not in the bundled feed."),
        reposts: unavailable(source, "X repost data is not in the bundled feed."),
        media: unavailable(source, "X media metadata is not in the bundled feed."),
      },
      warnings: ["X activity is limited to observed active days. A connected X API or account export is required for post, reply, view, like, repost, media, and theme evidence."],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const note = error instanceof TwitterFeedOfflineError ? error.attempts.map((attempt) => attempt.reason).join(" ") : message;
    const unavailableMetric = () => unavailable(source, note);
    return {
      connected: false,
      source,
      days: [],
      metrics: {
        observedActiveDays: unavailableMetric(),
        postsAndReplies: unavailableMetric(),
        views: unavailableMetric(),
        likes: unavailableMetric(),
        reposts: unavailableMetric(),
        media: unavailableMetric(),
      },
      warnings: [note],
    };
  }
}

export async function getMonthlyEvidence(user: UserConfig, month: string): Promise<MonthlyEvidence> {
  const range = monthRange(month);
  const [github, x] = await Promise.all([
    getGithubEvidence(user.githubLogin, month, process.env.GITHUB_TOKEN?.trim() ?? ""),
    getXEvidence(user, month),
  ]);
  return {
    account: { github: user.githubLogin, x: user.xLogin },
    generatedAt: new Date().toISOString(),
    range: { month, from: range.from, to: range.to },
    github,
    x,
  };
}
