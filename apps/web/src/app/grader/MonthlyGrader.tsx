"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Mode = "strict" | "balanced" | "encouraging";
type SubjectId = "engineering" | "product" | "shipping" | "focus" | "voice";

type Subject = {
  id: SubjectId;
  name: string;
  score: number | null;
  confidence: "High" | "Medium" | "Unavailable";
  exact: string[];
  reading: string;
};

type EvidenceState = "exact" | "partial" | "unavailable";

type LiveMetric = {
  value: number | null;
  state: EvidenceState;
  source: string;
  note?: string;
};

type LiveEvidence = {
  account: { github: string; x: string };
  generatedAt: string;
  range: { month: string; from: string; to: string };
  github: {
    connected: boolean;
    source: string;
    days: Array<{ date: string; count: number }>;
    repositories: Array<{ name: string; url: string }>;
    metrics: Record<
      | "contributions"
      | "activeDays"
      | "commits"
      | "commitRepositories"
      | "pullRequestsOpened"
      | "pullRequestsMerged"
      | "issuesOpened"
      | "reviews"
      | "repositoriesCreated"
      | "releases"
      | "deployments",
      LiveMetric
    >;
    warnings: string[];
  };
  x: {
    connected: boolean;
    source: string;
    days: Array<{ date: string; count: number }>;
    metrics: Record<
      "observedActiveDays" | "postsAndReplies" | "views" | "likes" | "reposts" | "media",
      LiveMetric
    >;
    warnings: string[];
  };
};

const subjects: Subject[] = [
  {
    id: "engineering",
    name: "Engineering output",
    score: 95,
    confidence: "High",
    exact: [
      "252 commits across 15 repositories.",
      "23 pull requests opened.",
      "298 GitHub contributions; activity recorded on all 31 days.",
    ],
    reading:
      "This was sustained, multi-repository execution—not a single burst. The score rewards volume alongside the breadth of real implementation work, rather than treating commit count as the grade by itself.",
  },
  {
    id: "product",
    name: "Product depth",
    score: 92,
    confidence: "Medium",
    exact: [
      "Main project evidence: makerspace/Spanner, Curius, didweship, Board, and Library.",
      "15 repositories had commits during the month.",
      "21 repositories were created.",
    ],
    reading:
      "The project mix points to serious system-building across several product surfaces. Depth scores highly, but this remains medium confidence because the imported summary does not yet identify features, users, or deployment outcomes project by project.",
  },
  {
    id: "shipping",
    name: "Shipping & quality",
    score: 91,
    confidence: "Medium",
    exact: [
      "23 pull requests were opened in July.",
      "Five named projects had active work recorded.",
      "Merge status, releases, deployments, tests, and production usage were not included in the source summary.",
    ],
    reading:
      "The PR cadence is a credible proxy for reviewable shipping, and the work appears to have moved beyond isolated experiments. The report deliberately does not claim release or quality metrics that were not verified.",
  },
  {
    id: "focus",
    name: "Focus & follow-through",
    score: 84,
    confidence: "Medium",
    exact: [
      "21 repositories were created while 15 repositories received commits.",
      "Work was distributed across Spanner, Curius, didweship, Board, and Library.",
      "No project-level completion or abandonment data was imported.",
    ],
    reading:
      "The range of work is impressive, but the number of new repositories creates real consolidation risk. This is not a penalty for curiosity; it is a prompt to make the next set of wins easier to finish, maintain, and explain.",
  },
  {
    id: "voice",
    name: "Public voice",
    score: 88,
    confidence: "Medium",
    exact: [
      "65 X posts and replies.",
      "Approximately 48.6K X views.",
      "Original-post versus reply counts, media count, and engagement detail were not included in the source summary.",
    ],
    reading:
      "The reach and cadence are meaningful. The grade stops short of an A because the supplied data cannot yet distinguish authored public ideas from conversation, or show which themes and formats earned attention.",
  },
];

const defaultWeights: Record<SubjectId, number> = {
  engineering: 28,
  product: 22,
  shipping: 20,
  focus: 16,
  voice: 14,
};

const modeAdjustments: Record<Mode, Record<SubjectId, number>> = {
  strict: { engineering: -3, product: -2, shipping: -3, focus: -5, voice: -2 },
  balanced: { engineering: 0, product: 0, shipping: 0, focus: 0, voice: 0 },
  encouraging: { engineering: 2, product: 2, shipping: 2, focus: 3, voice: 2 },
};

const principalComments = [
  "July was a month of serious making. You kept a rare daily rhythm while tackling work with real technical range. The next level is not more activity—it is choosing the few systems that deserve the full finish: a clear release, a durable home, and a story people can follow.",
  "This report shows unusual momentum: ambitious projects, steady engineering, and a public trail of the work. Keep that energy, but protect it with stronger endings. A smaller number of unmistakably finished systems would turn a very good month into an exceptional body of work.",
  "The strongest signal here is not the count; it is the consistency behind it. You built across a full month without disappearing. For August, make consolidation an explicit project: close loops, document what matters, and let your most important work become easier for others to see and use.",
];

const weeklyRows = [
  ["29 Jun — 5 Jul", "5 of 5", "Opening partial week"],
  ["6 — 12 Jul", "7 of 7", "Full-week GitHub activity"],
  ["13 — 19 Jul", "7 of 7", "Full-week GitHub activity"],
  ["20 — 26 Jul", "7 of 7", "Full-week GitHub activity"],
  ["27 Jul — 2 Aug", "5 of 5", "Closing partial week"],
];

const rawEvidence = [
  ["GitHub contributions", "298", "User-provided July monthly total", "Exact"],
  ["GitHub active days", "31 / 31", "User-provided July monthly total", "Exact"],
  ["Commits", "252 across 15 repositories", "User-provided July monthly total", "Exact"],
  ["Pull requests opened", "23", "User-provided July monthly total", "Exact"],
  ["Repositories created", "21", "User-provided July monthly total", "Exact"],
  ["X activity", "65 posts and replies", "User-provided July monthly total", "Exact"],
  ["X views", "≈ 48.6K", "User-provided July monthly total", "Approximate"],
  ["Project names", "Spanner · Curius · didweship · Board · Library", "User-provided project list", "Qualitative"],
  ["Merges, releases, deployments, users", "Unavailable", "No verified event evidence imported", "Unavailable"],
  ["Original posts / replies / media", "Unavailable", "No verified X event evidence imported", "Unavailable"],
];

function metricValue(metric: LiveMetric) {
  return metric.value ?? 0;
}

function boundedScore(value: number) {
  return Math.round(Math.min(100, Math.max(0, value)));
}

function metricLine(label: string, metric: LiveMetric, suffix = "") {
  const value = metric.value === null ? "Unavailable" : `${metric.value}${suffix}`;
  return `${label}: ${value}. ${metric.note ?? `Source: ${metric.source}.`}`;
}

function confidenceFromMetrics(metrics: LiveMetric[]): Subject["confidence"] {
  if (metrics.every((metric) => metric.state === "exact")) return "High";
  if (metrics.some((metric) => metric.value !== null)) return "Medium";
  return "Unavailable";
}

function liveSubjects(evidence: LiveEvidence): Subject[] {
  const github = evidence.github.metrics;
  const x = evidence.x.metrics;
  const [year, month] = evidence.range.month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const engineeringMetrics = [github.contributions, github.activeDays, github.commits, github.pullRequestsOpened];
  const productMetrics = [github.commitRepositories, github.repositoriesCreated, github.commits, github.issuesOpened];
  const shippingMetrics = [github.pullRequestsOpened, github.pullRequestsMerged, github.releases, github.reviews];
  const focusMetrics = [github.activeDays, github.commitRepositories, github.repositoriesCreated];
  const voiceMetrics = [x.observedActiveDays, x.postsAndReplies, x.views];

  const canGrade = (metrics: LiveMetric[]) => metrics.some((metric) => metric.value !== null);
  const engineeringScore = canGrade(engineeringMetrics)
    ? boundedScore(
        Math.min(32, metricValue(github.contributions) / 9) +
        Math.min(28, metricValue(github.commits) / 8) +
        Math.min(22, (metricValue(github.activeDays) / daysInMonth) * 22) +
        Math.min(18, metricValue(github.pullRequestsOpened) * 1.3)
      )
    : null;
  const productScore = canGrade(productMetrics)
    ? boundedScore(
        Math.min(40, metricValue(github.commitRepositories) * 3.5) +
        Math.min(18, metricValue(github.repositoriesCreated) * 2.2) +
        Math.min(25, metricValue(github.commits) / 10) +
        Math.min(17, metricValue(github.issuesOpened) * 2.5)
      )
    : null;
  const shippingScore = canGrade(shippingMetrics)
    ? boundedScore(
        Math.min(35, metricValue(github.pullRequestsOpened) * 1.7) +
        Math.min(32, metricValue(github.pullRequestsMerged) * 2) +
        Math.min(20, metricValue(github.releases) * 8) +
        Math.min(13, metricValue(github.reviews) * 1.5)
      )
    : null;
  const focusScore = canGrade(focusMetrics)
    ? boundedScore(
        Math.min(48, (metricValue(github.activeDays) / daysInMonth) * 48) +
        Math.min(32, metricValue(github.commitRepositories) * 2.8) +
        Math.max(0, 20 - Math.max(0, metricValue(github.repositoriesCreated) - 4) * 2)
      )
    : null;
  // Activity days are meaningful evidence of showing up, but they cannot
  // responsibly grade a public voice without totals, engagement, or themes.
  const voiceScore = x.postsAndReplies.value !== null || x.views.value !== null
    ? boundedScore(
        Math.min(42, metricValue(x.postsAndReplies) * 0.75) +
        Math.min(33, metricValue(x.observedActiveDays) * 1.2) +
        Math.min(25, Math.log10(Math.max(1, metricValue(x.views))) * 5)
      )
    : null;

  return [
    {
      id: "engineering",
      name: "Engineering output",
      score: engineeringScore,
      confidence: confidenceFromMetrics(engineeringMetrics),
      exact: [
        metricLine("GitHub contributions", github.contributions),
        metricLine("Active GitHub days", github.activeDays),
        metricLine("Authored commits", github.commits),
        metricLine("Pull requests opened", github.pullRequestsOpened),
      ],
      reading: "This mark is driven by sustained activity, code changes, and reviewable pull requests. It is intentionally not a simple commit-count score.",
    },
    {
      id: "product",
      name: "Product depth",
      score: productScore,
      confidence: confidenceFromMetrics(productMetrics),
      exact: [
        metricLine("Repositories with commit contributions", github.commitRepositories),
        metricLine("Repositories created", github.repositoriesCreated),
        metricLine("Authored commits", github.commits),
        metricLine("Issues opened", github.issuesOpened),
      ],
      reading: "This is a proxy for depth across active systems. Deployments, users, and project-level outcomes still need direct evidence before this can become a complete product assessment.",
    },
    {
      id: "shipping",
      name: "Shipping & quality",
      score: shippingScore,
      confidence: confidenceFromMetrics(shippingMetrics),
      exact: [
        metricLine("Pull requests opened", github.pullRequestsOpened),
        metricLine("Pull requests merged", github.pullRequestsMerged),
        metricLine("Releases in active repositories", github.releases),
        metricLine("Pull request reviews", github.reviews),
        metricLine("Deployments", github.deployments),
      ],
      reading: "Merges and releases are rewarded as stronger completion signals than raw activity. Deployment evidence is withheld until a deployment source is connected.",
    },
    {
      id: "focus",
      name: "Focus & follow-through",
      score: focusScore,
      confidence: confidenceFromMetrics(focusMetrics),
      exact: [
        metricLine("Active GitHub days", github.activeDays),
        metricLine("Repositories with commit contributions", github.commitRepositories),
        metricLine("Repositories created", github.repositoriesCreated),
      ],
      reading: "The score rewards a steady rhythm and meaningful progress across a manageable number of systems. New repositories only reduce this mark when they begin to outpace follow-through.",
    },
    {
      id: "voice",
      name: "Public voice",
      score: voiceScore,
      confidence: confidenceFromMetrics(voiceMetrics),
      exact: [
        metricLine("Observed active X days", x.observedActiveDays),
        metricLine("X posts and replies", x.postsAndReplies),
        metricLine("X views", x.views),
        metricLine("X likes", x.likes),
        metricLine("X reposts", x.reposts),
        metricLine("X media", x.media),
      ],
      reading: voiceScore === null
        ? "Activity-day data alone is not enough to grade a public voice. This subject will remain ungraded until complete post, reply, engagement, media, and theme data is connected."
        : "Original posts and replies should be assessed separately. This preliminary mark will gain confidence when the connected source includes formats, engagement, and recurring themes.",
    },
  ];
}

function liveRawEvidence(evidence: LiveEvidence) {
  const rows: Array<[string, string, string, string]> = [];
  const add = (label: string, metric: LiveMetric) => {
    rows.push([
      label,
      metric.value === null ? "Unavailable" : String(metric.value),
      metric.note ? `${metric.source} · ${metric.note}` : metric.source,
      metric.state === "exact" ? "Exact" : metric.state === "partial" ? "Partial" : "Unavailable",
    ]);
  };
  const github = evidence.github.metrics;
  add("GitHub contributions", github.contributions);
  add("GitHub active days", github.activeDays);
  add("Authored commits", github.commits);
  add("Repositories with commit contributions", github.commitRepositories);
  add("Pull requests opened", github.pullRequestsOpened);
  add("Pull requests merged", github.pullRequestsMerged);
  add("Issues opened", github.issuesOpened);
  add("Pull request reviews", github.reviews);
  add("Repositories created", github.repositoriesCreated);
  add("Releases", github.releases);
  add("Deployments", github.deployments);
  const x = evidence.x.metrics;
  add("Observed active X days", x.observedActiveDays);
  add("X posts and replies", x.postsAndReplies);
  add("X views", x.views);
  add("X likes", x.likes);
  add("X reposts", x.reposts);
  add("X media", x.media);
  return rows;
}

function liveWeeklyRows(evidence: LiveEvidence) {
  const weeks = new Map<string, { dates: string[]; contributions: number; activeDays: number }>();
  for (const day of evidence.github.days) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const dayOfWeek = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayOfWeek);
    const key = date.toISOString().slice(0, 10);
    const week = weeks.get(key) ?? { dates: [], contributions: 0, activeDays: 0 };
    week.dates.push(day.date);
    week.contributions += day.count;
    if (day.count > 0) week.activeDays++;
    weeks.set(key, week);
  }
  return [...weeks.entries()].map(([start, week]) => {
    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 6);
    const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
    const startLabel = `${startDate.getUTCDate()} ${monthFormatter.format(startDate)}`;
    const endLabel = `${endDate.getUTCDate()} ${monthFormatter.format(endDate)}`;
    return {
      week: `${startLabel} — ${endLabel}`,
      days: `${week.activeDays} of ${week.dates.length}`,
      reading: week.contributions > 0 ? `${week.contributions} GitHub contributions recorded` : "No GitHub contributions recorded",
      contribution: String(week.contributions),
    };
  });
}

function livePrincipalComments(evidence: LiveEvidence, score: number | null) {
  const github = evidence.github.metrics;
  const contributionText = github.contributions.value === null ? "the available GitHub evidence" : `${github.contributions.value} GitHub contributions`;
  const mergeText = github.pullRequestsMerged.value === null ? "completion signals still need more evidence" : `${github.pullRequestsMerged.value} merged pull requests gave the month concrete follow-through`;
  const created = github.repositoriesCreated.value ?? 0;
  return [
    `This is a ${score === null ? "partial" : `${score}-point`} reading built from ${contributionText}. ${mergeText}. The next step is to keep attaching releases, deployments, and user outcomes to the work so the grade can reward finished systems, not merely visible activity.`,
    `The evidence shows a month with a real operating rhythm. ${created > 8 ? `With ${created} new repositories, consolidation deserves deliberate attention: choose the work that gets a full finish and a clear public explanation.` : "Protect that rhythm by defining the next finished milestone before opening adjacent work."} The grader is holding back where X and deployment evidence are absent rather than inventing certainty.`,
    `The strongest claim this report can make is evidence-backed: you kept building. The stronger claim—that the work shipped, helped users, and found an audience—will become available when release, deployment, user, and complete X engagement data are connected.`,
  ];
}

function monthName(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return "Selected month";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

function letterGrade(score: number) {
  if (score >= 93) return "A";
  if (score >= 90) return "A−";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B−";
  if (score >= 77) return "C+";
  if (score >= 73) return "C";
  return "C−";
}

function clampWeight(value: number) {
  return Math.min(60, Math.max(0, value));
}

function classForConfidence(confidence: string) {
  return confidence === "High" || confidence === "Exact" ? "confidence-high" : "confidence-medium";
}

export function MonthlyGrader() {
  const [selectedMonth, setSelectedMonth] = useState("2026-07");
  const [mode, setMode] = useState<Mode>("balanced");
  const [weights, setWeights] = useState(defaultWeights);
  const [showWeights, setShowWeights] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [commentIndex, setCommentIndex] = useState(0);
  const [liveEvidence, setLiveEvidence] = useState<LiveEvidence | null>(null);
  const [syncState, setSyncState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSyncState("loading");
    setLiveEvidence(null);
    setCommentIndex(0);
    fetch(`/api/grader?month=${encodeURIComponent(selectedMonth)}&user=anish`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Evidence request failed (${response.status})`);
        return response.json() as Promise<LiveEvidence>;
      })
      .then((evidence) => {
        if (controller.signal.aborted) return;
        setLiveEvidence(evidence);
        setSyncState(evidence.github.connected ? "ready" : "unavailable");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[grader] evidence fetch failed", error);
        setSyncState("unavailable");
      });
    return () => controller.abort();
  }, [selectedMonth, refreshTick]);

  const hasSeed = selectedMonth === "2026-07";
  const hasLiveGithub = liveEvidence?.github.connected === true;
  const reportSubjects = useMemo(
    () => (hasLiveGithub && liveEvidence ? liveSubjects(liveEvidence) : subjects),
    [hasLiveGithub, liveEvidence]
  );
  const currentEvidence = hasLiveGithub && liveEvidence ? liveRawEvidence(liveEvidence) : rawEvidence;
  const hasReport = hasSeed || hasLiveGithub;
  const totalWeight = reportSubjects
    .filter((subject) => subject.score !== null)
    .reduce((total, subject) => total + weights[subject.id], 0);
  const overallScore = useMemo(() => {
    if (!hasReport || totalWeight === 0) return null;
    const weighted = reportSubjects.reduce((sum, subject) => {
      if (subject.score === null) return sum;
      return sum + Math.min(100, Math.max(0, subject.score + modeAdjustments[mode][subject.id])) * weights[subject.id];
    }, 0);
    return Math.round(weighted / totalWeight);
  }, [hasReport, mode, reportSubjects, totalWeight, weights]);
  const reportComments = hasLiveGithub && liveEvidence
    ? livePrincipalComments(liveEvidence, overallScore)
    : principalComments;
  const reportWeeklyRows = hasLiveGithub && liveEvidence ? liveWeeklyRows(liveEvidence) : null;

  const updateWeight = (id: SubjectId, value: string) => {
    setWeights((current) => ({ ...current, [id]: clampWeight(Number(value) || 0) }));
  };

  const exportReport = () => {
    if (!overallScore) return;
    const report = [
      `MONTHLY WORK REVIEW — ${monthName(selectedMonth).toUpperCase()}`,
      `Overall: ${letterGrade(overallScore)} / ${overallScore} out of 100`,
      `Mode: ${mode}`,
      "",
      "SUBJECT LEDGER",
      ...reportSubjects.map((subject) => {
        if (subject.score === null) return `${subject.name}: unavailable (weight ${weights[subject.id]}%)`;
        const adjusted = Math.min(100, Math.max(0, subject.score + modeAdjustments[mode][subject.id]));
        return `${subject.name}: ${letterGrade(adjusted)} / ${adjusted} (weight ${weights[subject.id]}%)`;
      }),
      "",
      "DATA STATUS",
      hasLiveGithub && liveEvidence
        ? `GitHub: ${liveEvidence.github.source}; X: ${liveEvidence.x.source}`
        : "July 2026 user-provided seed summary",
      "",
      "PRINCIPAL'S COMMENT",
      reportComments[commentIndex],
      "",
      "RAW EVIDENCE",
      ...currentEvidence.map(([metric, value, source, confidence]) => `${metric}: ${value} — ${confidence}; ${source}`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `monthly-review-${selectedMonth}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="grader-page">
      <div className="grader-shell">
        <header className="grader-topbar">
          <Link href="/" className="grader-wordmark" aria-label="Back to did we ship today">
            did we ship today?
          </Link>
          <div className="grader-topbar-right">
            <span className="grader-edition">Personal work review</span>
            <button type="button" className="text-button no-print" onClick={() => window.print()}>
              Print / save PDF
            </button>
          </div>
        </header>

        <section className="grader-masthead" aria-labelledby="grader-title">
          <p className="eyebrow">The monthly grader · 01</p>
          <div className="grader-title-row">
            <div>
              <h1 id="grader-title">A fair reading of a month’s work.</h1>
              <p className="grader-dek">
                An evidence-led report on what you built, what you finished, and what deserves more care next.
              </p>
            </div>
            <div className="month-control no-print">
              <label htmlFor="review-month">Review month</label>
              <input
                id="review-month"
                type="month"
                value={selectedMonth}
                max="2026-08"
                onChange={(event) => setSelectedMonth(event.target.value)}
              />
              <div className="sync-control" aria-live="polite">
                <span className={`confidence ${syncState === "ready" ? "confidence-high" : "confidence-medium"}`}>
                  {syncState === "loading" ? "Checking sources" : syncState === "ready" ? "Live GitHub evidence" : hasSeed ? "July seed fallback" : "Source unavailable"}
                </span>
                <button type="button" className="text-button" onClick={() => setRefreshTick((tick) => tick + 1)} disabled={syncState === "loading"}>
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </section>

        {!hasReport ? (
          <section className="empty-month" aria-live="polite">
            <p className="eyebrow">{syncState === "loading" ? "Collecting evidence" : "Evidence unavailable"}</p>
            <h2>{syncState === "loading" ? `Reviewing ${monthName(selectedMonth)}…` : `${monthName(selectedMonth)} has not been imported yet.`}</h2>
            <p>
              {syncState === "loading"
                ? "The grader is collecting the selected month’s account evidence. It will only issue marks after the source data is available."
                : "The grader leaves scores blank until it can collect auditable account evidence. Add a GitHub token to enable the live GitHub import; July 2026 remains available as the supplied example."}
            </p>
            {syncState !== "loading" && (
              <button type="button" className="button-dark no-print" onClick={() => setSelectedMonth("2026-07")}>
                View July example
              </button>
            )}
          </section>
        ) : (
          <>
            <section className="grade-hero" aria-label="Overall grade">
              <div className="grade-stamp">
                <span className="eyebrow">Final grade</span>
                <span className="grade-letter">{overallScore ? letterGrade(overallScore) : "—"}</span>
                <span className="grade-score">{overallScore ?? "—"} <small>/ 100</small></span>
              </div>
              <div className="grade-summary">
                <div className="section-heading-row">
                  <p className="eyebrow">{monthName(selectedMonth)} · report card</p>
                  <span className={`confidence ${hasLiveGithub ? "confidence-medium" : "confidence-high"}`}>
                    {hasLiveGithub ? "Mixed confidence" : "High confidence"}
                  </span>
                </div>
                <h2>{hasLiveGithub ? "Evidence first. The grade follows." : "Exceptional output, with room to consolidate."}</h2>
                <p>
                  {hasLiveGithub
                    ? "This report is recalculated from the connected GitHub account for the selected calendar month. It withholds the public-voice mark until complete X post and engagement data is available."
                    : "You made a full month of meaningful technical progress across ambitious systems. The grade recognizes that range—then asks for clearer finishes, fewer loose ends, and more visible proof of what shipped."}
                </p>
                <div className="mode-strip no-print" aria-label="Grading mode">
                  <span>Read it</span>
                  {(["strict", "balanced", "encouraging"] as Mode[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={mode === item ? "active" : ""}
                      onClick={() => setMode(item)}
                      aria-pressed={mode === item}
                    >
                      {item}
                    </button>
                  ))}
                  <span className="mode-note">{mode === "strict" ? "Higher bar for proof of completion" : mode === "encouraging" ? "Credits trajectory and momentum" : "Weights evidence and ambition evenly"}</span>
                </div>
              </div>
            </section>

            <section className="report-section subjects-section" aria-labelledby="subjects-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">01 · Subject ledger</p>
                  <h2 id="subjects-heading">The marks</h2>
                </div>
                <div className="section-actions no-print">
                  <button type="button" className="text-button" onClick={() => setShowWeights((open) => !open)} aria-expanded={showWeights}>
                    {showWeights ? "Close weights" : "Adjust weights"}
                  </button>
                  <button type="button" className="text-button" onClick={exportReport}>
                    Export report
                  </button>
                </div>
              </div>

              {showWeights && (
                <div className="weights-panel no-print">
                  <div className="weights-panel-copy">
                    <strong>Set the curriculum.</strong>
                    <span>Weights are normalized automatically. Current input: {totalWeight}%.</span>
                  </div>
                  <div className="weight-grid">
                    {reportSubjects.map((subject) => (
                      <label key={subject.id}>
                        <span>{subject.name}</span>
                        <input
                          type="number"
                          min="0"
                          max="60"
                          value={weights[subject.id]}
                          onChange={(event) => updateWeight(subject.id, event.target.value)}
                        />
                        <i>%</i>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="subject-ledger" role="table" aria-label="Subject grades">
                <div className="subject-ledger-head" role="row">
                  <span role="columnheader">Subject</span>
                  <span role="columnheader">Mark</span>
                  <span role="columnheader">Weight</span>
                  <span role="columnheader">Confidence</span>
                  <span className="no-print" role="columnheader">Evidence</span>
                </div>
                {reportSubjects.map((subject) => {
                  const adjustedScore = subject.score === null
                    ? null
                    : Math.min(100, Math.max(0, subject.score + modeAdjustments[mode][subject.id]));
                  return (
                    <details className="subject-row" key={subject.id}>
                      <summary>
                        <span className="subject-name">{subject.name}</span>
                        <span className="subject-mark"><b>{adjustedScore === null ? "—" : letterGrade(adjustedScore)}</b><i>{adjustedScore ?? "ungraded"}</i></span>
                        <span className="subject-weight">{weights[subject.id]}%</span>
                        <span className={`confidence ${classForConfidence(subject.confidence)}`}>{subject.confidence}</span>
                        <span className="why-link no-print">Why? <i>↓</i></span>
                      </summary>
                      <div className="subject-why">
                        <div>
                          <p className="eyebrow">Measured evidence</p>
                          <ul>
                            {subject.exact.map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="eyebrow">Evaluator’s reading</p>
                          <p>{subject.reading}</p>
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>
              <p className="method-note">Scores use the selected weights and only the subjects with enough evidence to grade. “Why?” keeps measured facts separate from the evaluator’s interpretation.</p>
            </section>

            <section className="report-section weekly-section" aria-labelledby="weeks-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">02 · Calendar weeks</p>
                  <h2 id="weeks-heading">The rhythm</h2>
                </div>
                <span className={`confidence ${hasLiveGithub ? "confidence-high" : "confidence-medium"}`}>
                  {hasLiveGithub ? "Exact calendar data" : "Partial confidence"}
                </span>
              </div>
              <div className="weekly-table-wrap">
                <table className="weekly-table">
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>GitHub active days</th>
                      <th>Reading</th>
                      <th>{hasLiveGithub ? "GitHub contributions" : "Commits / PRs / releases"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportWeeklyRows
                      ? reportWeeklyRows.map((row) => (
                          <tr key={row.week}>
                            <td>{row.week}</td>
                            <td className="weekly-active">{row.days}</td>
                            <td>{row.reading}</td>
                            <td>{row.contribution}</td>
                          </tr>
                        ))
                      : weeklyRows.map(([week, days, reading]) => (
                          <tr key={week}>
                            <td>{week}</td>
                            <td className="weekly-active">{days}</td>
                            <td>{reading}</td>
                            <td className="unavailable">Unavailable in the seeded summary</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
              <p className="method-note">
                {hasLiveGithub
                  ? "Weekly activity and contribution totals come directly from GitHub’s calendar. Commit, pull-request, release, and deployment events are intentionally not allocated to a week unless their event dates are collected."
                  : "Because GitHub activity was recorded on every day of July, active-day totals can be derived by calendar week. Repository events were not date-level imported, so no weekly commit or shipping counts are inferred."}
              </p>
            </section>

            <section className="report-section assessment-grid" aria-label="Assessment">
              <div className="assessment-column">
                <p className="eyebrow">03 · Strongest work</p>
                <h2>What earned the grade</h2>
                <ol className="editorial-list">
                  {hasLiveGithub && liveEvidence ? (
                    <>
                      <li><span>01</span><p><strong>A verifiable work rhythm.</strong> {liveEvidence.github.metrics.activeDays.value ?? "Unavailable"} active GitHub days and {liveEvidence.github.metrics.contributions.value ?? "Unavailable"} contributions are directly recorded for this month.</p></li>
                      <li><span>02</span><p><strong>Reviewable engineering evidence.</strong> {liveEvidence.github.metrics.pullRequestsOpened.value ?? "Unavailable"} pull requests opened and {liveEvidence.github.metrics.pullRequestsMerged.value ?? "Unavailable"} merged give the report stronger evidence than commit count alone.</p></li>
                      <li><span>03</span><p><strong>Auditable raw sources.</strong> Every collected metric carries its collection source and state in the audit trail, so the report can be challenged rather than merely admired.</p></li>
                    </>
                  ) : (
                    <>
                      <li><span>01</span><p><strong>A month-long engineering habit.</strong> Activity on all 31 days is unusually durable evidence of sustained engagement.</p></li>
                      <li><span>02</span><p><strong>Real technical range.</strong> The work touched five named systems and 15 repositories, suggesting meaningful depth beyond one narrow task.</p></li>
                      <li><span>03</span><p><strong>A public trail of the work.</strong> 65 X posts or replies and approximately 48.6K views gave the month an outward-facing layer.</p></li>
                    </>
                  )}
                </ol>
              </div>
              <div className="assessment-column missed-column">
                <p className="eyebrow">04 · Missed opportunities</p>
                <h2>What would make it stronger</h2>
                <ol className="editorial-list">
                  {hasLiveGithub && liveEvidence ? (
                    <>
                      <li><span>01</span><p><strong>Attach a deployment receipt.</strong> Deployment evidence is currently unavailable, so the report cannot yet distinguish a merged change from a live system.</p></li>
                      <li><span>02</span><p><strong>Connect complete X analytics.</strong> The existing feed confirms activity days but does not preserve complete posts, replies, views, likes, reposts, media, or themes.</p></li>
                      <li><span>03</span><p><strong>Show the outcome beside the work.</strong> Releases and merges are useful evidence, but user, documentation, test, and performance signals would make the product assessment much more decisive.</p></li>
                    </>
                  ) : (
                    <>
                      <li><span>01</span><p><strong>Make fewer projects legible end to end.</strong> Twenty-one new repositories is exciting, but each additional start raises the bar for release notes, maintenance, and a clear outcome.</p></li>
                      <li><span>02</span><p><strong>Capture shipped proof.</strong> Merges, releases, deployments, users, and test outcomes are unavailable here. Collecting them would turn a persuasive story into a decisive one.</p></li>
                      <li><span>03</span><p><strong>Separate broadcast from conversation.</strong> Public voice is stronger when original posts, replies, media, and recurring ideas can be evaluated independently.</p></li>
                    </>
                  )}
                </ol>
              </div>
            </section>

            <section className="principal-section" aria-labelledby="principal-heading">
              <div className="principal-label">
                <p className="eyebrow">05 · Principal’s comment</p>
                <span className={`confidence ${hasLiveGithub ? "confidence-medium" : "confidence-medium"}`}>Mixed confidence</span>
              </div>
              <blockquote id="principal-heading">“{reportComments[commentIndex]}”</blockquote>
              <button
                type="button"
                className="text-button no-print"
                onClick={() => setCommentIndex((index) => (index + 1) % reportComments.length)}
              >
                Regenerate comment <span aria-hidden="true">↻</span>
              </button>
            </section>

            <section className="recommendations report-section" aria-labelledby="recommendations-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">06 · Next month</p>
                  <h2 id="recommendations-heading">Three assignments</h2>
                </div>
                <span className="confidence confidence-medium">Evaluator guidance</span>
              </div>
              <div className="recommendation-list">
                <article><span>01</span><h3>Choose two flagship systems.</h3><p>Write down what “finished” means for each, then stop opening adjacent projects until that definition is met.</p></article>
                <article><span>02</span><h3>Ship with a receipt.</h3><p>For every meaningful release, preserve the PR, deployment or release link, a changelog note, and one user or performance signal.</p></article>
                <article><span>03</span><h3>Publish the lesson, not only the activity.</h3><p>Turn one technical decision each week into an original post with a clear point of view, an image or demo, and a link back to the work.</p></article>
              </div>
            </section>

            <section className="audit-section" aria-labelledby="audit-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">Audit trail</p>
                  <h2 id="audit-heading">Raw evidence, kept apart.</h2>
                </div>
                <button type="button" className="text-button no-print" onClick={() => setShowAudit((open) => !open)} aria-expanded={showAudit}>
                  {showAudit ? "Hide evidence" : "View evidence"}
                </button>
              </div>
              {showAudit && (
                <div className="audit-table-wrap">
                  <table className="audit-table">
                    <thead><tr><th>Metric</th><th>Recorded value</th><th>Source</th><th>State</th></tr></thead>
                    <tbody>
                      {currentEvidence.map(([metric, value, source, state]) => (
                        <tr key={metric}>
                          <td>{metric}</td><td>{value}</td><td>{source}</td><td><span className={`confidence ${state === "Exact" ? "confidence-high" : "confidence-medium"}`}>{state}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="audit-source-note">
                    {hasLiveGithub && liveEvidence
                      ? `Collected ${new Date(liveEvidence.generatedAt).toLocaleString()} from ${liveEvidence.github.source}; X evidence comes from ${liveEvidence.x.source}. ${[...liveEvidence.github.warnings, ...liveEvidence.x.warnings].join(" ")}`
                      : "Seeded from the July 2026 details supplied for this review. The live collector will replace this source note with GitHub-backed metrics when GITHUB_TOKEN is configured."}
                  </p>
                  {hasLiveGithub && liveEvidence.github.repositories.length > 0 && (
                    <p className="audit-projects">
                      <strong>Repositories identified by the month’s commit search:</strong>{" "}
                      {liveEvidence.github.repositories.map((repository, index) => (
                        <span key={repository.name}>
                          {index > 0 && " · "}
                          <a href={repository.url} target="_blank" rel="noreferrer">{repository.name}</a>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        <footer className="grader-footer">
          <span>Monthly grader · evidence before assertion</span>
          <span>{hasLiveGithub ? "Live GitHub evidence · X data partial" : hasSeed ? "July example · source summary on file" : "Awaiting source evidence"}</span>
        </footer>
      </div>
    </main>
  );
}
