import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDb } from "../db";

/**
 * Nightly intelligence digest, per docs/LEARNING.md "Development loop".
 *
 * Aggregates a day of telemetry into the exact minimum contents LEARNING.md
 * requires, plus a ranked "Top 5 suspected product problems" section, and the
 * V1 scorecard (docs/MILESTONES.md) with day-over-day deltas vs the previous
 * digest.
 *
 * Non-negotiable (CLAUDE.md): digests contain ONLY aggregates and anonymized
 * exemplars — never raw user-identifying data. This builder NEVER reads the
 * `query` column of reports nor the `query` prop of search_started; exemplars
 * are derived solely from enum fields (category, queryType). A final scrub
 * (`scrubPii`) redacts any email/phone-like text as defence in depth.
 *
 * `buildDigest` is pure-ish: it reads the DB and repo files and returns the
 * artifacts. The reporting date is injected (never Date.now()) so it is
 * deterministic and testable; the thin CLI wrapper supplies today's date.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EVAL_PASS_TARGET = 0.95;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_PATTERN = /(?:\d[\s\-.()]?){9,}\d/g;

export interface BuildDigestOptions {
  /** Reporting day, YYYY-MM-DD. The digest aggregates that UTC calendar day. */
  date?: string;
  /** Optional rolling window (ms) ending at the day's end; widens the default single-day window. */
  sinceMs?: number;
}

export interface DigestArtifacts {
  json: DigestJson;
  markdown: string;
}

interface EventRow {
  name: string;
  props: Record<string, unknown>;
  receivedAt: string;
}

interface ScorecardRow {
  id: string;
  target: string;
  ownedBy: string;
  measured: string;
  status: string;
}

export interface DigestJson {
  date: string;
  window: { startIso: string; endIso: string };
  eventTotals: { total: number; byName: Record<string, number> };
  topCategories: { category: string; reports: number; share: number }[];
  queryExemplars: { label: string; count: number }[];
  failureAndRetryByStage: {
    stage: string;
    attempts: number;
    failures: number;
    failureRate: number;
    retries: number;
    retryRate: number;
  }[];
  lowestConfidencePatterns: {
    distribution: Record<string, number>;
    lowConfidenceByCategory: { category: string; count: number }[];
    feedback: { up: number; down: number };
  };
  userEditedAssumptions: { total: number; byAction: Record<string, number> };
  userEditedQuestions: {
    total: number;
    byAction: Record<string, number>;
    removedPlaybookQuestions: { questionId: string; count: number }[];
  };
  flowAbandonment: { stage: string; count: number; avgElapsedMs: number }[];
  growth: {
    shareCreated: number;
    sharePageViewed: number;
    ctaClicked: number;
    sharePageConversion: number;
    polls: { created: number; voted: number; commented: number };
    priceWatchSet: number;
  };
  evalSuite: {
    present: boolean;
    file: string | null;
    ranAt: string | null;
    total: number | null;
    passRate: number | null;
    target: number;
    contractFailureRate: number | null;
  };
  scorecard: {
    rows: ScorecardRow[];
    metrics: Record<string, number | null>;
    deltas: Record<string, number | null>;
    comparedTo: string | null;
  };
  suspectedProblems: { rank: number; title: string; signal: string; evidence: string }[];
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

function windowBounds(date: string, sinceMs?: number): { startIso: string; endIso: string } {
  const dayStartMs = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStartMs)) {
    throw new Error(`Invalid digest date: ${date}`);
  }
  const endMs = dayStartMs + DAY_MS;
  const startMs = sinceMs && sinceMs > 0 ? endMs - sinceMs : dayStartMs;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

function loadEvents(startIso: string, endIso: string): EventRow[] {
  const rows = getDb()
    .prepare<[string, string], { name: string; props: string; received_at: string }>(
      `SELECT name, props, received_at FROM telemetry_events
       WHERE received_at >= ? AND received_at < ?`,
    )
    .all(startIso, endIso);
  return rows.map((row) => ({
    name: row.name,
    receivedAt: row.received_at,
    props: safeParseProps(row.props),
  }));
}

function safeParseProps(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Small aggregation helpers
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const k = key(item);
    if (k == null) {
      return acc;
    }
    return { ...acc, [k]: (acc[k] ?? 0) + 1 };
  }, {});
}

function str(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" ? value : null;
}

function num(props: Record<string, unknown>, key: string): number | null {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function p75(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.75 * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Defence in depth: redact any email/phone-like text before it can reach an artifact. */
function scrubPii(text: string): string {
  return text.replace(EMAIL_PATTERN, "[redacted-email]").replace(PHONE_PATTERN, "[redacted-number]");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildTopCategories(events: EventRow[]): DigestJson["topCategories"] {
  const completed = events.filter((e) => e.name === "report_completed");
  const counts = countBy(completed, (e) => str(e.props, "category"));
  const total = completed.length;
  return Object.entries(counts)
    .map(([category, reports]) => ({ category, reports, share: round(ratio(reports, total)) }))
    .sort((a, b) => b.reports - a.reports);
}

/** Anonymized: category · queryType only — never raw query text. */
function buildQueryExemplars(events: EventRow[]): DigestJson["queryExemplars"] {
  const completed = events.filter((e) => e.name === "report_completed");
  const counts = countBy(completed, (e) => {
    const category = str(e.props, "category");
    const queryType = str(e.props, "queryType");
    return category && queryType ? `${category} · ${queryType}` : null;
  });
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function buildFailureAndRetryByStage(events: EventRow[]): DigestJson["failureAndRetryByStage"] {
  const stages = events.filter((e) => e.name === "research_stage_completed");
  const failures = events.filter((e) => e.name === "report_failed");
  const stageNames = new Set<string>();
  for (const e of stages) {
    const s = str(e.props, "stage");
    if (s) stageNames.add(s);
  }
  for (const e of failures) {
    const s = str(e.props, "stage");
    if (s) stageNames.add(s);
  }
  return [...stageNames]
    .map((stage) => {
      const stageRuns = stages.filter((e) => str(e.props, "stage") === stage);
      const stageFailures = failures.filter((e) => str(e.props, "stage") === stage).length;
      const attempts = stageRuns.length + stageFailures;
      const runsWithRetries = stageRuns.filter((e) => (num(e.props, "retries") ?? 0) > 0).length;
      const totalRetries = stageRuns.reduce((sum, e) => sum + (num(e.props, "retries") ?? 0), 0);
      return {
        stage,
        attempts,
        failures: stageFailures,
        failureRate: round(ratio(stageFailures, attempts)),
        retries: totalRetries,
        retryRate: round(ratio(runsWithRetries, stageRuns.length || 1)),
      };
    })
    .sort((a, b) => b.failureRate - a.failureRate || b.attempts - a.attempts);
}

function buildLowestConfidencePatterns(events: EventRow[]): DigestJson["lowestConfidencePatterns"] {
  const completed = events.filter((e) => e.name === "report_completed");
  const distribution = countBy(completed, (e) => str(e.props, "confidence"));
  const lowish = completed.filter((e) => {
    const c = str(e.props, "confidence");
    return c === "low" || c === "medium";
  });
  const byCategory = countBy(lowish, (e) => str(e.props, "category"));
  const feedback = events.filter((e) => e.name === "report_feedback");
  return {
    distribution,
    lowConfidenceByCategory: Object.entries(byCategory)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    feedback: {
      up: feedback.filter((e) => str(e.props, "rating") === "up").length,
      down: feedback.filter((e) => str(e.props, "rating") === "down").length,
    },
  };
}

function buildUserEditedAssumptions(events: EventRow[]): DigestJson["userEditedAssumptions"] {
  const edits = events.filter((e) => e.name === "assumption_edited");
  return { total: edits.length, byAction: countBy(edits, (e) => str(e.props, "action")) };
}

function buildUserEditedQuestions(events: EventRow[]): DigestJson["userEditedQuestions"] {
  const edits = events.filter((e) => e.name === "question_edited");
  const removedPlaybook = edits.filter(
    (e) => str(e.props, "action") === "removed" && str(e.props, "questionId") != null,
  );
  const removedCounts = countBy(removedPlaybook, (e) => str(e.props, "questionId"));
  return {
    total: edits.length,
    byAction: countBy(edits, (e) => str(e.props, "action")),
    removedPlaybookQuestions: Object.entries(removedCounts)
      .map(([questionId, count]) => ({ questionId, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function buildFlowAbandonment(events: EventRow[]): DigestJson["flowAbandonment"] {
  const abandoned = events.filter((e) => e.name === "research_abandoned");
  const byStage = new Map<string, number[]>();
  for (const e of abandoned) {
    const stage = str(e.props, "stage") ?? "unknown";
    const elapsed = num(e.props, "elapsedMs") ?? 0;
    byStage.set(stage, [...(byStage.get(stage) ?? []), elapsed]);
  }
  return [...byStage.entries()]
    .map(([stage, elapsedList]) => ({
      stage,
      count: elapsedList.length,
      avgElapsedMs: Math.round(elapsedList.reduce((a, b) => a + b, 0) / elapsedList.length),
    }))
    .sort((a, b) => b.count - a.count);
}

function buildGrowth(byName: Record<string, number>): DigestJson["growth"] {
  const sharePageViewed = byName.share_page_viewed ?? 0;
  const ctaClicked = byName.cta_clicked ?? 0;
  return {
    shareCreated: byName.share_created ?? 0,
    sharePageViewed,
    ctaClicked,
    sharePageConversion: round(ratio(ctaClicked, sharePageViewed)),
    polls: {
      created: byName.poll_created ?? 0,
      voted: byName.poll_voted ?? 0,
      commented: byName.poll_commented ?? 0,
    },
    priceWatchSet: byName.price_watch_set ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Eval suite status (newest evals/results/*.json)
// ---------------------------------------------------------------------------

interface EvalResultFile {
  ranAt?: string;
  total?: number;
  s3_contractFailureRate?: number;
  s4_passRate?: number;
  s4_target?: number;
}

function buildEvalSuite(): DigestJson["evalSuite"] {
  const dir = `${REPO_ROOT}evals/results`;
  const empty: DigestJson["evalSuite"] = {
    present: false,
    file: null,
    ranAt: null,
    total: null,
    passRate: null,
    target: EVAL_PASS_TARGET,
    contractFailureRate: null,
  };
  if (!existsSync(dir)) {
    return empty;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const newest = files.at(-1);
  if (!newest) {
    return empty;
  }
  try {
    const parsed = JSON.parse(readFileSync(`${dir}/${newest}`, "utf8")) as EvalResultFile;
    return {
      present: true,
      file: newest,
      ranAt: parsed.ranAt ?? null,
      total: parsed.total ?? null,
      passRate: parsed.s4_passRate ?? null,
      target: parsed.s4_target ?? EVAL_PASS_TARGET,
      contractFailureRate: parsed.s3_contractFailureRate ?? null,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Scorecard (docs/MILESTONES.md) + day-over-day deltas
// ---------------------------------------------------------------------------

function parseScorecard(): ScorecardRow[] {
  const path = `${REPO_ROOT}docs/MILESTONES.md`;
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8").split("\n");
  const rows: ScorecardRow[] = [];
  for (const line of lines) {
    const match = line.match(/^\|\s*(S\d+)\s*\|(.+)$/);
    if (!match) {
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length >= 5) {
      rows.push({
        id: cells[0] ?? "",
        target: cells[1] ?? "",
        ownedBy: cells[2] ?? "",
        measured: cells[3] ?? "",
        status: cells[4] ?? "",
      });
    }
  }
  return rows;
}

/** Numeric metrics computed from today's data — the values that can carry a day-over-day delta. */
function computeScorecardMetrics(
  events: EventRow[],
  growth: DigestJson["growth"],
  evalSuite: DigestJson["evalSuite"],
): Record<string, number | null> {
  const completed = events.filter((e) => e.name === "report_completed");
  const failed = events.filter((e) => e.name === "report_failed");
  const totalMsValues = completed
    .map((e) => num(e.props, "totalMs"))
    .filter((v): v is number => v != null);
  const sourceCounts = completed
    .map((e) => num(e.props, "sourceCount"))
    .filter((v): v is number => v != null);
  return {
    reportsCompleted: completed.length,
    reportFailureRate: round(ratio(failed.length, completed.length + failed.length)),
    reportTotalMsP75: p75(totalMsValues),
    avgSourceCount: sourceCounts.length
      ? round(sourceCounts.reduce((a, b) => a + b, 0) / sourceCounts.length, 2)
      : null,
    evalPassRate: evalSuite.passRate,
    evalContractFailureRate: evalSuite.contractFailureRate,
    sharePageConversion: growth.sharePageConversion,
  };
}

function loadPreviousMetrics(date: string): { metrics: Record<string, number | null>; source: string } | null {
  const dir = `${REPO_ROOT}intelligence/digests`;
  if (!existsSync(dir)) {
    return null;
  }
  const prior = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f < `${date}.json`)
    .sort();
  const newest = prior.at(-1);
  if (!newest) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(`${dir}/${newest}`, "utf8")) as Partial<DigestJson>;
    const metrics = parsed.scorecard?.metrics;
    return metrics ? { metrics, source: newest } : null;
  } catch {
    return null;
  }
}

function computeDeltas(
  current: Record<string, number | null>,
  previous: Record<string, number | null> | null,
): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => {
      const prev = previous?.[key];
      if (value == null || prev == null) {
        return [key, null];
      }
      return [key, round(value - prev, 4)];
    }),
  );
}

// ---------------------------------------------------------------------------
// Top 5 suspected product problems (heuristic, evidence-backed)
// ---------------------------------------------------------------------------

interface Candidate {
  score: number;
  title: string;
  signal: string;
  evidence: string;
}

function suspectProblems(
  json: Omit<DigestJson, "suspectedProblems">,
): DigestJson["suspectedProblems"] {
  const candidates: Candidate[] = [];

  for (const stage of json.flowAbandonment) {
    candidates.push({
      score: stage.count * 10,
      title: `Users abandon research at the "${stage.stage}" stage`,
      signal: "research_abandoned",
      evidence: `${stage.count} abandonment${stage.count === 1 ? "" : "s"} at "${stage.stage}" (avg ${stage.avgElapsedMs}ms elapsed before leaving).`,
    });
  }

  for (const stage of json.failureAndRetryByStage) {
    if (stage.failures > 0) {
      candidates.push({
        score: stage.failureRate * 100 + stage.failures * 5,
        title: `"${stage.stage}" stage is failing`,
        signal: "report_failed",
        evidence: `${stage.failures} failure(s) at "${stage.stage}" over ${stage.attempts} attempt(s) (failure rate ${(stage.failureRate * 100).toFixed(1)}%).`,
      });
    }
    if (stage.retryRate >= 0.5 && stage.attempts >= 3) {
      candidates.push({
        score: stage.retryRate * 40,
        title: `"${stage.stage}" stage retries frequently`,
        signal: "research_stage_completed.retries",
        evidence: `${(stage.retryRate * 100).toFixed(0)}% of "${stage.stage}" runs needed a retry (${stage.retries} retries across ${stage.attempts} attempts).`,
      });
    }
  }

  const dist = json.lowestConfidencePatterns.distribution;
  const lowMed = (dist.low ?? 0) + (dist.medium ?? 0);
  const totalConf = lowMed + (dist.high ?? 0);
  if (totalConf > 0 && ratio(lowMed, totalConf) >= 0.5) {
    const worstCategory = json.lowestConfidencePatterns.lowConfidenceByCategory[0];
    candidates.push({
      score: ratio(lowMed, totalConf) * 60,
      title: "Many reports land below high confidence",
      signal: "report_completed.confidence",
      evidence: `${lowMed}/${totalConf} reports were low/medium confidence${worstCategory ? `; worst in "${worstCategory.category}" (${worstCategory.count})` : ""}. Likely a sourcing or playbook gap.`,
    });
  }

  const down = json.lowestConfidencePatterns.feedback.down;
  if (down > 0) {
    candidates.push({
      score: down * 25,
      title: "Users are thumbs-downing reports",
      signal: "report_feedback",
      evidence: `${down} thumbs-down vs ${json.lowestConfidencePatterns.feedback.up} thumbs-up — direct quality signal; mine these into eval cases.`,
    });
  }

  if (json.evalSuite.present && json.evalSuite.passRate != null && json.evalSuite.passRate < json.evalSuite.target) {
    candidates.push({
      score: (json.evalSuite.target - json.evalSuite.passRate) * 120,
      title: "Golden-query eval pass rate is below target",
      signal: "evals/results",
      evidence: `Eval pass rate ${(json.evalSuite.passRate * 100).toFixed(1)}% < target ${(json.evalSuite.target * 100).toFixed(0)}% (${json.evalSuite.file}). Gates S4.`,
    });
  }

  for (const q of json.userEditedQuestions.removedPlaybookQuestions) {
    if (q.count >= 2) {
      candidates.push({
        score: q.count * 12,
        title: `Playbook question "${q.questionId}" is repeatedly removed`,
        signal: "question_edited",
        evidence: `Removed ${q.count} times by users — a likely playbook over-ask; consider demoting it.`,
      });
    }
  }

  if (json.growth.sharePageViewed >= 3 && json.growth.sharePageConversion < 0.1) {
    candidates.push({
      score: 30,
      title: "Share-page visitors rarely start their own research",
      signal: "share_page_viewed → cta_clicked",
      evidence: `${json.growth.ctaClicked}/${json.growth.sharePageViewed} visitors clicked the CTA (${(json.growth.sharePageConversion * 100).toFixed(0)}% conversion).`,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c, i) => ({
      rank: i + 1,
      title: scrubPii(c.title),
      signal: c.signal,
      evidence: scrubPii(c.evidence),
    }));
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmtNum(value: number | null): string {
  return value == null ? "n/a" : String(value);
}

function fmtDelta(value: number | null): string {
  if (value == null) {
    return "—";
  }
  if (value === 0) {
    return "±0";
  }
  return value > 0 ? `+${value}` : String(value);
}

function renderMarkdown(json: DigestJson): string {
  const lines: string[] = [];
  const push = (line = ""): void => {
    lines.push(line);
  };

  push(`# Tally nightly digest — ${json.date}`);
  push();
  push(`Window: ${json.window.startIso} → ${json.window.endIso}`);
  push(`Total telemetry events: **${json.eventTotals.total}**`);
  push();
  push("_Aggregates and anonymized exemplars only — no raw user data (per docs/LEARNING.md)._");
  push();

  push("## Event volume");
  push();
  if (Object.keys(json.eventTotals.byName).length === 0) {
    push("_No telemetry events in window._");
  } else {
    for (const [name, count] of Object.entries(json.eventTotals.byName).sort((a, b) => b[1] - a[1])) {
      push(`- \`${name}\` — ${count}`);
    }
  }
  push();

  push("## Top categories");
  push();
  if (json.topCategories.length === 0) {
    push("_No completed reports in window._");
  } else {
    for (const c of json.topCategories) {
      push(`- **${c.category}** — ${c.reports} reports (${(c.share * 100).toFixed(0)}%)`);
    }
  }
  push();

  push("## Anonymized query exemplars");
  push();
  push("_By category · query type (never raw query text)._");
  push();
  if (json.queryExemplars.length === 0) {
    push("_None._");
  } else {
    for (const e of json.queryExemplars) {
      push(`- ${e.label} — ${e.count}`);
    }
  }
  push();

  push("## Failure & retry rates by stage");
  push();
  if (json.failureAndRetryByStage.length === 0) {
    push("_No stage activity in window._");
  } else {
    push("| Stage | Attempts | Failures | Failure rate | Retries | Retry rate |");
    push("|-------|---------:|---------:|-------------:|--------:|-----------:|");
    for (const s of json.failureAndRetryByStage) {
      push(
        `| ${s.stage} | ${s.attempts} | ${s.failures} | ${(s.failureRate * 100).toFixed(1)}% | ${s.retries} | ${(s.retryRate * 100).toFixed(0)}% |`,
      );
    }
  }
  push();

  push("## Lowest-confidence report patterns");
  push();
  const dist = json.lowestConfidencePatterns.distribution;
  push(
    `Confidence distribution — high: ${dist.high ?? 0}, medium: ${dist.medium ?? 0}, low: ${dist.low ?? 0}.`,
  );
  push(
    `Feedback — 👍 ${json.lowestConfidencePatterns.feedback.up} / 👎 ${json.lowestConfidencePatterns.feedback.down}.`,
  );
  if (json.lowestConfidencePatterns.lowConfidenceByCategory.length > 0) {
    push();
    push("Low/medium confidence by category:");
    for (const c of json.lowestConfidencePatterns.lowConfidenceByCategory) {
      push(`- ${c.category} — ${c.count}`);
    }
  }
  push();

  push("## Most user-edited assumptions & questions");
  push();
  push(`Assumption edits: ${json.userEditedAssumptions.total} (${describeActions(json.userEditedAssumptions.byAction)}).`);
  push(`Question edits: ${json.userEditedQuestions.total} (${describeActions(json.userEditedQuestions.byAction)}).`);
  if (json.userEditedQuestions.removedPlaybookQuestions.length > 0) {
    push();
    push("Most-removed playbook questions (candidate demotions):");
    for (const q of json.userEditedQuestions.removedPlaybookQuestions) {
      push(`- \`${q.questionId}\` — removed ${q.count}×`);
    }
  }
  push();

  push("## Flow abandonment points");
  push();
  if (json.flowAbandonment.length === 0) {
    push("_No abandonment recorded._");
  } else {
    for (const s of json.flowAbandonment) {
      push(`- **${s.stage}** — ${s.count} abandonment(s), avg ${s.avgElapsedMs}ms elapsed`);
    }
  }
  push();

  push("## Share / poll / price-watch usage");
  push();
  const g = json.growth;
  push(`- Shares created: ${g.shareCreated}`);
  push(`- Share pages viewed: ${g.sharePageViewed}`);
  push(`- CTA clicks: ${g.ctaClicked}`);
  push(`- Share-page conversion (cta/view): ${(g.sharePageConversion * 100).toFixed(0)}%`);
  push(`- Polls — created ${g.polls.created}, voted ${g.polls.voted}, commented ${g.polls.commented}`);
  push(`- Price watches set: ${g.priceWatchSet}`);
  push();

  push("## Eval-suite status");
  push();
  if (!json.evalSuite.present) {
    push("_No eval results found in evals/results._");
  } else {
    push(`- File: \`${json.evalSuite.file}\` (ran ${json.evalSuite.ranAt ?? "unknown"})`);
    push(`- Cases: ${fmtNum(json.evalSuite.total)}`);
    push(
      `- Pass rate: ${json.evalSuite.passRate == null ? "n/a" : `${(json.evalSuite.passRate * 100).toFixed(1)}%`} (target ${(json.evalSuite.target * 100).toFixed(0)}%)`,
    );
    push(
      `- Contract failure rate: ${json.evalSuite.contractFailureRate == null ? "n/a" : `${(json.evalSuite.contractFailureRate * 100).toFixed(1)}%`}`,
    );
  }
  push();

  push("## V1 scorecard — current values & day-over-day deltas");
  push();
  push(
    json.scorecard.comparedTo
      ? `_Deltas computed vs previous digest \`${json.scorecard.comparedTo}\`._`
      : "_No previous digest found; deltas start tomorrow._",
  );
  push();
  push("Computed engine metrics (day-over-day):");
  push();
  push("| Metric | Value | Δ vs prev |");
  push("|--------|------:|----------:|");
  for (const [key, value] of Object.entries(json.scorecard.metrics)) {
    push(`| ${key} | ${fmtNum(value)} | ${fmtDelta(json.scorecard.deltas[key] ?? null)} |`);
  }
  push();
  if (json.scorecard.rows.length > 0) {
    push("Scorecard targets (from docs/MILESTONES.md):");
    push();
    push("| # | Target | Owned | Measured | Status |");
    push("|---|--------|-------|----------|--------|");
    for (const r of json.scorecard.rows) {
      push(`| ${r.id} | ${r.target} | ${r.ownedBy} | ${r.measured} | ${r.status} |`);
    }
    push();
  }

  push("## Top 5 suspected product problems");
  push();
  if (json.suspectedProblems.length === 0) {
    push("_No problems surfaced from the data in this window._");
  } else {
    for (const p of json.suspectedProblems) {
      push(`${p.rank}. **${p.title}**`);
      push(`   - Signal: \`${p.signal}\``);
      push(`   - Evidence: ${p.evidence}`);
    }
  }
  push();

  return scrubPii(lines.join("\n"));
}

function describeActions(byAction: Record<string, number>): string {
  const entries = Object.entries(byAction);
  return entries.length === 0 ? "none" : entries.map(([a, n]) => `${a}: ${n}`).join(", ");
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export function buildDigest(opts: BuildDigestOptions = {}): DigestArtifacts {
  const date = opts.date ?? "1970-01-01";
  const { startIso, endIso } = windowBounds(date, opts.sinceMs);
  const events = loadEvents(startIso, endIso);
  const byName = countBy(events, (e) => e.name);

  const growth = buildGrowth(byName);
  const evalSuite = buildEvalSuite();
  const scorecardRows = parseScorecard();
  const metrics = computeScorecardMetrics(events, growth, evalSuite);
  const previous = loadPreviousMetrics(date);
  const deltas = computeDeltas(metrics, previous?.metrics ?? null);

  const partial: Omit<DigestJson, "suspectedProblems"> = {
    date,
    window: { startIso, endIso },
    eventTotals: { total: events.length, byName },
    topCategories: buildTopCategories(events),
    queryExemplars: buildQueryExemplars(events),
    failureAndRetryByStage: buildFailureAndRetryByStage(events),
    lowestConfidencePatterns: buildLowestConfidencePatterns(events),
    userEditedAssumptions: buildUserEditedAssumptions(events),
    userEditedQuestions: buildUserEditedQuestions(events),
    flowAbandonment: buildFlowAbandonment(events),
    growth,
    evalSuite,
    scorecard: {
      rows: scorecardRows,
      metrics,
      deltas,
      comparedTo: previous?.source ?? null,
    },
  };

  const json: DigestJson = { ...partial, suspectedProblems: suspectProblems(partial) };
  return { json, markdown: renderMarkdown(json) };
}
