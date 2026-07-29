import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { PlanQuestion, Report } from "../../shared/report";

// Set the DB path BEFORE any db function runs (connection opens lazily).
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-mining-test-")), "test.db");

import { saveReport, saveServerEvent } from "../db";
import { mineSignals } from "./mining";

const PRICE = { min: 100, max: 200, currency: "USD", display: "$100–$200" };

interface ReportOverrides {
  query?: string;
  queryType?: Report["queryType"];
  category?: Report["category"]["id"];
  mode?: Report["meta"]["mode"];
  questions?: PlanQuestion[];
}

function userQuestion(id: string, text: string): PlanQuestion {
  return { id, text, status: "done", whyItMatters: null, origin: "user", sourceCount: 1 };
}

// A minimal-but-valid report (validated by ReportSchema on save). created_at is
// safely in the past so it survives the miner's now-bounded window.
function makeReport(id: string, overrides: ReportOverrides = {}): Report {
  const categoryId = overrides.category ?? "consumer-electronics";
  return {
    id,
    query: overrides.query ?? "best budget headphones",
    hoursSaved: null,
    queryType: overrides.queryType ?? "need",
    category: { id: categoryId, label: "Consumer electronics", confidence: 0.9 },
    createdAt: "2020-01-01T10:00:00.000Z",
    assumptions: [{ id: "a1", text: "Budget under $200", origin: "inferred", affirmed: true }],
    questions: overrides.questions ?? [
      { id: "q1", text: "Which models are most reliable?", status: "done", whyItMatters: null, origin: "playbook", sourceCount: 3 },
    ],
    verdict: {
      headline: "Get the Soundcore Space One.",
      rationale: "Best mix of comfort and battery for the budget.",
      confidence: "high",
      confidenceReason: "12 sources across 4 classes agree.",
      decisiveFactors: ["Battery life"],
    },
    bestFit: {
      name: "Soundcore Space One",
      priceRange: PRICE,
      rating: { value: 4.5, outOf: 5, summary: "Owners praise comfort." },
      pros: ["Great battery"],
      cons: ["Bulky case"],
      whyBest: "Fits the budget with the best battery.",
      sourceIds: ["s1"],
      imageUrl: null,
    },
    alternatives: [
      {
        rank: 2,
        name: "JBL Tune 770NC",
        priceRange: PRICE,
        ratingValue: 4.2,
        note: "Pick this if you want a lighter fit.",
        pros: ["Lighter on the head"],
        cons: ["Weaker ANC"],
        reviewSummary: "Reviewers like the fit.",
        isKeyAlternative: true,
      imageUrl: null,
      },
    ],
    retailers: [
      { seller: "Amazon", kind: "online", price: PRICE, availability: "In stock", url: null, locality: null },
    ],
    location: null,
    sources: [
      { id: "s1", title: "Best budget headphones", url: "https://www.rtings.com/headphones", domain: "rtings.com", sourceClass: "editorial" },
    ],
    meta: {
      engineVersion: "v1",
      playbookId: categoryId,
      playbookVersion: "v1",
      promptVersions: { synthesize: "v1" },
      model: "gemini-test",
      mode: overrides.mode ?? "full",
      stageTimings: [{ stage: "synthesize", ms: 1200, retries: 0 }],
      totalMs: 5000,
      disagreements: [],
      sourceDiversity: { count: 12, classesRepresented: ["editorial", "retailer"] },
      reviewSecondOpinion: null,
    },
  };
}

const ENVELOPE = { sessionId: "sess_abc123XYZ", deviceId: "dev_abc123XYZ", ts: "2026-07-27T12:00:00.000Z" };
function evt(eventId: string, body: object): object {
  return { ...ENVELOPE, eventId, ...body };
}

// ---- Seed a realistic slice of telemetry + reports ------------------------

// (a) Two user-added questions that normalize to the same key -> add candidate.
saveReport(
  makeReport("rep_add_1", {
    questions: [userQuestion("uq1", "How loud is it at night?")],
  }),
);
saveReport(
  makeReport("rep_add_2", {
    questions: [userQuestion("uq2", "How loud is it at night??")],
  }),
);
// A user question carrying PII must be scrubbed out entirely.
saveReport(
  makeReport("rep_add_pii", {
    questions: [userQuestion("uq3", "email me at leak@example.com when reviewed")],
  }),
);

// (b) A removed playbook question -> demote candidate (ce-price is a real id).
saveServerEvent(evt("evt_rm_1", { name: "question_edited", researchId: "rs1", action: "removed", questionId: "ce-price" }));
// A user-added question event corroborates volume (text lives on the report).
saveServerEvent(evt("evt_add_1", { name: "question_edited", researchId: "rs1", action: "added", questionId: null }));

// (c) A low-confidence report -> eval-case candidate.
saveReport(makeReport("rep_low", { query: "wifi extender for a thick-walled flat", mode: "quick", queryType: "problem" }));
saveServerEvent(
  evt("evt_low_1", {
    name: "report_completed",
    reportId: "rep_low",
    queryType: "problem",
    category: "consumer-electronics",
    mode: "quick",
    confidence: "low",
    sourceCount: 4,
    sourceClassCount: 2,
    disagreementCount: 0,
    totalMs: 5000,
    playbookVersion: "v1",
  }),
);

// (d) A thumbs-down report whose query is PII-bearing -> eval-case, anonymized.
saveReport(makeReport("rep_down", { query: "reach me at buyer@example.com", category: "home-goods", mode: "full", queryType: "need" }));
saveServerEvent(evt("evt_down_1", { name: "report_feedback", reportId: "rep_down", rating: "down" }));

const result = mineSignals();

describe("mineSignals", () => {
  test("surfaces frequently user-added questions as ADD candidates", () => {
    const candidate = result.playbookAddCandidates.find((c) => c.normalizedText === "how loud is it at night");
    expect(candidate).toBeDefined();
    expect(candidate?.count).toBe(2);
    expect(result.totals.userAddedQuestionEvents).toBe(1);
  });

  test("surfaces a removed playbook question as a DEMOTE candidate with its template", () => {
    const demote = result.playbookDemoteCandidates.find((c) => c.questionId === "ce-price");
    expect(demote).toBeDefined();
    expect(demote?.playbookId).toBe("consumer-electronics");
    expect(demote?.template).toBe("What are the real online and local price ranges right now?");
    expect(demote?.removedCount).toBe(1);
  });

  test("turns a low-confidence report into an eval-case candidate", () => {
    const c = result.evalCaseCandidates.find((x) => x.id === "mined-lowconf-rep_low");
    expect(c).toBeDefined();
    expect(c?.source).toBe("low-confidence");
    expect(c?.query).toBe("wifi extender for a thick-walled flat");
    expect(c?.mode).toBe("quick");
    expect(c?.expect).toEqual({
      category: "consumer-electronics",
      queryType: "problem",
      minSources: 5,
      minSourceClasses: 2,
      assumptionHints: [],
    });
  });

  test("turns a thumbs-down report into an eval-case candidate", () => {
    const c = result.evalCaseCandidates.find((x) => x.id === "mined-thumbsdown-rep_down");
    expect(c).toBeDefined();
    expect(c?.source).toBe("thumbs-down");
    expect(c?.expect.category).toBe("home-goods");
  });

  test("emits no PII: scrubs PII question text and anonymizes PII queries", () => {
    // The PII-bearing user question never becomes an add candidate.
    expect(
      result.playbookAddCandidates.some((c) => c.normalizedText.includes("leak")),
    ).toBe(false);
    // The PII-bearing thumbs-down query is replaced with a generic placeholder.
    const down = result.evalCaseCandidates.find((x) => x.id === "mined-thumbsdown-rep_down");
    expect(down?.query).not.toContain("buyer@example.com");
    expect(down?.query).toContain("home-goods");
    // Belt and suspenders: no email/phone-like text anywhere in the output.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("leak@example.com");
    expect(serialized).not.toContain("buyer@example.com");
  });
});
