import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Point the DB at a fresh temp file BEFORE db.ts opens its lazy connection.
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-digest-test-")), "test.db");

import { getDb } from "../db";
import { buildDigest, type DigestJson } from "./digest";

const DATE = "2026-07-27";
const TS = "2026-07-27T12:00:00.000Z";

let counter = 0;

/** Insert a raw telemetry row directly (bypasses the ingest PII guard on purpose). */
function seed(name: string, props: Record<string, unknown>, receivedAt = TS): void {
  counter += 1;
  getDb()
    .prepare(
      `INSERT INTO telemetry_events (id, name, session_id, device_id, ts, received_at, props)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`evt_${counter}`, name, "sess_abc123XYZ", "dev_abc123XYZ", TS, receivedAt, JSON.stringify(props));
}

function seedFixture(): void {
  // Two completed reports (one medium confidence), plus stages, a failure,
  // abandonment, edits, growth, and — critically — an email buried in props.
  seed("report_completed", {
    reportId: "r1",
    queryType: "named-product",
    category: "consumer-electronics",
    mode: "quick",
    confidence: "medium",
    sourceCount: 8,
    sourceClassCount: 3,
    disagreementCount: 1,
    totalMs: 60000,
    playbookVersion: "1.0.0",
  });
  seed("report_completed", {
    reportId: "r2",
    queryType: "need",
    category: "home-goods",
    mode: "full",
    confidence: "high",
    sourceCount: 12,
    sourceClassCount: 4,
    disagreementCount: 0,
    totalMs: 120000,
    playbookVersion: "1.0.0",
  });
  seed("research_stage_completed", { reportId: "r1", stage: "classify", ms: 6000, retries: 0 });
  seed("research_stage_completed", { reportId: "r1", stage: "synthesize", ms: 20000, retries: 2 });
  seed("report_failed", { reportId: null, stage: "synthesize", code: "timeout", totalMs: 30000, retried: true });
  seed("research_abandoned", { researchId: "x1", stage: "gather", elapsedMs: 15000 });
  seed("research_abandoned", { researchId: "x2", stage: "gather", elapsedMs: 22000 });
  seed("assumption_edited", { researchId: "x1", action: "reworded" });
  seed("question_edited", { researchId: "x1", action: "removed", questionId: "ce-warranty" });
  seed("question_edited", { researchId: "x2", action: "removed", questionId: "ce-warranty" });
  seed("report_feedback", { reportId: "r1", rating: "down" });
  seed("share_page_viewed", { reportId: "r1", firstTouch: true });
  seed("share_page_viewed", { reportId: "r1", firstTouch: true });
  seed("share_page_viewed", { reportId: "r1", firstTouch: false });
  seed("cta_clicked", { reportId: "r1", cta: "research-your-own" });
  seed("price_watch_set", { reportId: "r1", rank: 1 });
  // PII trap: an email in a query prop. buildDigest must never surface it.
  seed("search_started", { query: "gift for jane.doe@example.com under $50", mode: "quick", entry: "home-search" });
}

const REQUIRED_JSON_KEYS: (keyof DigestJson)[] = [
  "date",
  "window",
  "eventTotals",
  "topCategories",
  "queryExemplars",
  "failureAndRetryByStage",
  "lowestConfidencePatterns",
  "userEditedAssumptions",
  "userEditedQuestions",
  "flowAbandonment",
  "growth",
  "evalSuite",
  "scorecard",
  "suspectedProblems",
];

const REQUIRED_HEADINGS = [
  "# Tally nightly digest",
  "## Event volume",
  "## Top categories",
  "## Anonymized query exemplars",
  "## Failure & retry rates by stage",
  "## Lowest-confidence report patterns",
  "## Most user-edited assumptions & questions",
  "## Flow abandonment points",
  "## Share / poll / price-watch usage",
  "## Eval-suite status",
  "## V1 scorecard — current values & day-over-day deltas",
  "## Top 5 suspected product problems",
];

describe("buildDigest", () => {
  seedFixture();
  const { json, markdown } = buildDigest({ date: DATE });

  test("json contains every required section key", () => {
    for (const key of REQUIRED_JSON_KEYS) {
      expect(json, `missing json section: ${key}`).toHaveProperty(key);
    }
  });

  test("markdown contains every required heading incl. problems + scorecard", () => {
    for (const heading of REQUIRED_HEADINGS) {
      expect(markdown, `missing heading: ${heading}`).toContain(heading);
    }
  });

  test("aggregates telemetry correctly", () => {
    expect(json.eventTotals.total).toBeGreaterThanOrEqual(17);
    expect(json.topCategories.map((c) => c.category)).toContain("consumer-electronics");
    expect(json.failureAndRetryByStage.find((s) => s.stage === "synthesize")?.failures).toBe(1);
    expect(json.flowAbandonment.find((s) => s.stage === "gather")?.count).toBe(2);
    expect(json.userEditedQuestions.removedPlaybookQuestions[0]).toEqual({
      questionId: "ce-warranty",
      count: 2,
    });
    expect(json.growth.sharePageViewed).toBe(3);
    expect(json.growth.ctaClicked).toBe(1);
  });

  test("produces a ranked Top 5 suspected problems list with evidence", () => {
    expect(json.suspectedProblems.length).toBeGreaterThan(0);
    expect(json.suspectedProblems.length).toBeLessThanOrEqual(5);
    expect(json.suspectedProblems[0]?.rank).toBe(1);
    for (const problem of json.suspectedProblems) {
      expect(problem.evidence.length).toBeGreaterThan(0);
      expect(problem.signal.length).toBeGreaterThan(0);
    }
  });

  test("exemplars are anonymized (category · queryType), never raw query text", () => {
    for (const exemplar of json.queryExemplars) {
      expect(exemplar.label).toMatch(/·/);
      expect(exemplar.label).not.toContain("gift for");
    }
  });

  test("NO PII leaks: no email or raw query text in json or markdown", () => {
    const serialized = JSON.stringify(json);
    const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    expect(serialized).not.toMatch(emailPattern);
    expect(markdown).not.toMatch(emailPattern);
    expect(serialized).not.toContain("jane.doe");
    expect(serialized).not.toContain("gift for");
    expect(markdown).not.toContain("jane.doe");
  });

  test("scorecard is present with rows and computed metrics", () => {
    expect(Object.keys(json.scorecard.metrics).length).toBeGreaterThan(0);
    // docs/MILESTONES.md defines S1..S12; parsing should find at least a few.
    expect(json.scorecard.rows.length).toBeGreaterThan(0);
    expect(json.scorecard.rows[0]?.id).toMatch(/^S\d+$/);
  });
});
