"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Mode = "strict" | "balanced" | "encouraging";
type SubjectId = "engineering" | "product" | "shipping" | "focus" | "voice";

type Subject = {
  id: SubjectId;
  name: string;
  score: number;
  confidence: "High" | "Medium";
  exact: string[];
  reading: string;
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

  const hasSeed = selectedMonth === "2026-07";
  const totalWeight = Object.values(weights).reduce((total, weight) => total + weight, 0);
  const overallScore = useMemo(() => {
    if (!hasSeed || totalWeight === 0) return null;
    const weighted = subjects.reduce((sum, subject) => {
      return sum + (subject.score + modeAdjustments[mode][subject.id]) * weights[subject.id];
    }, 0);
    return Math.round(weighted / totalWeight);
  }, [hasSeed, mode, totalWeight, weights]);

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
      ...subjects.map(
        (subject) =>
          `${subject.name}: ${letterGrade(subject.score + modeAdjustments[mode][subject.id])} / ${subject.score + modeAdjustments[mode][subject.id]} (weight ${weights[subject.id]}%)`
      ),
      "",
      "PRINCIPAL'S COMMENT",
      principalComments[commentIndex],
      "",
      "RAW EVIDENCE",
      ...rawEvidence.map(([metric, value, source, confidence]) => `${metric}: ${value} — ${confidence}; ${source}`),
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
            </div>
          </div>
        </section>

        {!hasSeed ? (
          <section className="empty-month" aria-live="polite">
            <p className="eyebrow">Evidence unavailable</p>
            <h2>{monthName(selectedMonth)} has not been imported yet.</h2>
            <p>
              The grader will leave scores blank until account activity is collected and auditable. July 2026 is available as the seeded example.
            </p>
            <button type="button" className="button-dark no-print" onClick={() => setSelectedMonth("2026-07")}>
              View July example
            </button>
          </section>
        ) : (
          <>
            <section className="grade-hero" aria-label="Overall grade">
              <div className="grade-stamp">
                <span className="eyebrow">Final grade</span>
                <span className="grade-letter">{overallScore ? letterGrade(overallScore) : "—"}</span>
                <span className="grade-score">{overallScore} <small>/ 100</small></span>
              </div>
              <div className="grade-summary">
                <div className="section-heading-row">
                  <p className="eyebrow">{monthName(selectedMonth)} · report card</p>
                  <span className="confidence confidence-high">High confidence</span>
                </div>
                <h2>Exceptional output, with room to consolidate.</h2>
                <p>
                  You made a full month of meaningful technical progress across ambitious systems. The grade recognizes that range—then asks for clearer finishes, fewer loose ends, and more visible proof of what shipped.
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
                    {subjects.map((subject) => (
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
                {subjects.map((subject) => {
                  const adjustedScore = subject.score + modeAdjustments[mode][subject.id];
                  return (
                    <details className="subject-row" key={subject.id}>
                      <summary>
                        <span className="subject-name">{subject.name}</span>
                        <span className="subject-mark"><b>{letterGrade(adjustedScore)}</b><i>{adjustedScore}</i></span>
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
              <p className="method-note">Scores use the selected weights. “Why?” keeps measured facts separate from the evaluator’s interpretation.</p>
            </section>

            <section className="report-section weekly-section" aria-labelledby="weeks-heading">
              <div className="section-heading-row">
                <div>
                  <p className="eyebrow">02 · Calendar weeks</p>
                  <h2 id="weeks-heading">The rhythm</h2>
                </div>
                <span className="confidence confidence-medium">Partial confidence</span>
              </div>
              <div className="weekly-table-wrap">
                <table className="weekly-table">
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>GitHub active days</th>
                      <th>Reading</th>
                      <th>Commits / PRs / releases</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyRows.map(([week, days, reading]) => (
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
              <p className="method-note">Because GitHub activity was recorded on every day of July, active-day totals can be derived by calendar week. Repository events were not date-level imported, so no weekly commit or shipping counts are inferred.</p>
            </section>

            <section className="report-section assessment-grid" aria-label="Assessment">
              <div className="assessment-column">
                <p className="eyebrow">03 · Strongest work</p>
                <h2>What earned the grade</h2>
                <ol className="editorial-list">
                  <li><span>01</span><p><strong>A month-long engineering habit.</strong> Activity on all 31 days is unusually durable evidence of sustained engagement.</p></li>
                  <li><span>02</span><p><strong>Real technical range.</strong> The work touched five named systems and 15 repositories, suggesting meaningful depth beyond one narrow task.</p></li>
                  <li><span>03</span><p><strong>A public trail of the work.</strong> 65 X posts or replies and approximately 48.6K views gave the month an outward-facing layer.</p></li>
                </ol>
              </div>
              <div className="assessment-column missed-column">
                <p className="eyebrow">04 · Missed opportunities</p>
                <h2>What would make it stronger</h2>
                <ol className="editorial-list">
                  <li><span>01</span><p><strong>Make fewer projects legible end to end.</strong> Twenty-one new repositories is exciting, but each additional start raises the bar for release notes, maintenance, and a clear outcome.</p></li>
                  <li><span>02</span><p><strong>Capture shipped proof.</strong> Merges, releases, deployments, users, and test outcomes are unavailable here. Collecting them would turn a persuasive story into a decisive one.</p></li>
                  <li><span>03</span><p><strong>Separate broadcast from conversation.</strong> Public voice is stronger when original posts, replies, media, and recurring ideas can be evaluated independently.</p></li>
                </ol>
              </div>
            </section>

            <section className="principal-section" aria-labelledby="principal-heading">
              <div className="principal-label">
                <p className="eyebrow">05 · Principal’s comment</p>
                <span className="confidence confidence-medium">Mixed confidence</span>
              </div>
              <blockquote id="principal-heading">“{principalComments[commentIndex]}”</blockquote>
              <button
                type="button"
                className="text-button no-print"
                onClick={() => setCommentIndex((index) => (index + 1) % principalComments.length)}
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
                      {rawEvidence.map(([metric, value, source, state]) => (
                        <tr key={metric}>
                          <td>{metric}</td><td>{value}</td><td>{source}</td><td><span className={`confidence ${state === "Exact" ? "confidence-high" : "confidence-medium"}`}>{state}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="audit-source-note">Seeded from the July 2026 details supplied for this review. A browser-connected collection will replace this source note with links to the underlying GitHub and X events.</p>
                </div>
              )}
            </section>
          </>
        )}

        <footer className="grader-footer">
          <span>Monthly grader · evidence before assertion</span>
          <span>{hasSeed ? "July example · source summary on file" : "Awaiting source evidence"}</span>
        </footer>
      </div>
    </main>
  );
}
