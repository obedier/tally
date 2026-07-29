import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { Report } from "../shared/report";

// Set the DB path BEFORE any db function runs (the connection opens lazily,
// so this module-level assignment wins even though imports are hoisted).
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-db-test-")), "test.db");

import Database from "better-sqlite3";
import {
  deleteReport,
  getEventCounts,
  getReport,
  listReports,
  saveClientEvents,
  saveReport,
  saveServerEvent,
} from "./db";

const PRICE = { min: 100, max: 200, currency: "USD", display: "$100–$200" };

function makeReport(id: string, createdAt: string, query = "best budget headphones"): Report {
  return {
    id,
    query,
    hoursSaved: null,
    queryType: "need",
    category: { id: "consumer-electronics", label: "Consumer electronics", confidence: 0.9 },
    createdAt,
    assumptions: [{ id: "a1", text: "Budget under $200", origin: "inferred", affirmed: true }],
    questions: [
      {
        id: "q1",
        text: "Which models are most reliable?",
        status: "done",
        whyItMatters: null,
        origin: "playbook",
        sourceCount: 3,
      },
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
        reviewSummary: "Reviewers like the fit, note weaker noise cancelling.",
        isKeyAlternative: true,
      imageUrl: null,
      },
    ],
    retailers: [
      { seller: "Amazon", kind: "online", price: PRICE, availability: "In stock", url: null, locality: null },
    ],
    location: null,
    sources: [
      {
        id: "s1",
        title: "Best budget headphones",
        url: "https://www.rtings.com/headphones",
        domain: "rtings.com",
        sourceClass: "editorial",
      },
    ],
    meta: {
      engineVersion: "v1",
      playbookId: "consumer-electronics",
      playbookVersion: "v1",
      promptVersions: { synthesize: "v1" },
      model: "gemini-test",
      mode: "full",
      stageTimings: [{ stage: "synthesize", ms: 1200, retries: 0 }],
      totalMs: 5000,
      disagreements: [],
      sourceDiversity: { count: 12, classesRepresented: ["editorial", "retailer"] },
      reviewSecondOpinion: null,
    },
  };
}

const ENVELOPE = {
  eventId: "evt_00000001",
  sessionId: "sess_abc123XYZ",
  deviceId: "dev_abc123XYZ",
  ts: "2026-07-27T12:00:00.000Z",
};

function envelope(eventId: string): typeof ENVELOPE {
  return { ...ENVELOPE, eventId };
}

const VALID_EVENTS: object[] = [
  {
    ...envelope("evt_search_1"),
    name: "search_started",
    query: "best budget headphones",
    mode: "full",
    entry: "home-search",
  },
  {
    ...envelope("evt_stage_1"),
    name: "research_stage_completed",
    reportId: "r1",
    stage: "synthesize",
    ms: 1200,
    retries: 0,
  },
  {
    ...envelope("evt_done_1"),
    name: "report_completed",
    reportId: "r1",
    queryType: "need",
    category: "consumer-electronics",
    mode: "full",
    confidence: "high",
    sourceCount: 12,
    sourceClassCount: 4,
    disagreementCount: 0,
    totalMs: 5000,
    playbookVersion: "v1",
  },
  {
    ...envelope("evt_fail_1"),
    name: "report_failed",
    reportId: null,
    stage: "classify",
    code: "timeout",
    totalMs: 3000,
    retried: true,
  },
  { ...envelope("evt_view_1"), name: "report_viewed", reportId: "r1", surface: "summary" },
  {
    ...envelope("evt_click_1"),
    name: "source_clicked",
    reportId: "r1",
    sourceId: "s1",
    sourceClass: "editorial",
  },
];

function readRejections(): { id: string; reason: string; received_at: string }[] {
  const raw = new Database(process.env.TALLY_DB_PATH as string, { readonly: true });
  try {
    return raw
      .prepare("SELECT * FROM rejected_events")
      .all() as { id: string; reason: string; received_at: string }[];
  } finally {
    raw.close();
  }
}

describe("reports", () => {
  test("round-trips a full report through save/get", () => {
    const report = makeReport("rep_roundtrip", "2026-07-27T10:00:00.000Z");
    saveReport(report);
    expect(getReport("rep_roundtrip")).toEqual(report);
  });

  test("returns null for an unknown report id", () => {
    expect(getReport("rep_missing")).toBeNull();
  });

  test("lists newest first with summary fields, capped at 50", () => {
    for (let i = 0; i < 55; i += 1) {
      const minute = String(i).padStart(2, "0");
      saveReport(makeReport(`rep_list_${minute}`, `2026-07-26T11:${minute}:00.000Z`, `query ${i}`));
    }
    const reports = listReports();
    expect(reports.length).toBe(50);
    expect(reports[0]).toEqual({
      id: "rep_roundtrip",
      query: "best budget headphones",
      createdAt: "2026-07-27T10:00:00.000Z",
      verdictHeadline: "Get the Soundcore Space One.",
      category: "consumer-electronics",
    });
    expect(reports[1]?.id).toBe("rep_list_54");
  });

  test("deletes a report exactly once", () => {
    saveReport(makeReport("rep_delete", "2026-07-27T09:00:00.000Z"));
    expect(deleteReport("rep_delete")).toBe(true);
    expect(getReport("rep_delete")).toBeNull();
    expect(deleteReport("rep_delete")).toBe(false);
  });
});

describe("telemetry validation", () => {
  test("accepts every event name in the contract", () => {
    const result = saveClientEvents(VALID_EVENTS);
    expect(result).toEqual({ accepted: 6, rejected: 0 });
    const counts = Object.fromEntries(getEventCounts().map((row) => [row.name, row.count]));
    expect(counts).toEqual({
      search_started: 1,
      research_stage_completed: 1,
      report_completed: 1,
      report_failed: 1,
      report_viewed: 1,
      source_clicked: 1,
    });
  });

  test("rejects an event missing envelope fields", () => {
    const before = readRejections().length;
    const result = saveClientEvents([
      { name: "report_viewed", reportId: "r1", surface: "summary" },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    const rejections = readRejections();
    expect(rejections.length).toBe(before + 1);
    expect(rejections.at(-1)?.reason).toBe("schema-invalid");
  });

  test("rejects a bad sessionId format", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_badsess_1"),
        sessionId: "bad id!",
        name: "report_viewed",
        reportId: "r1",
        surface: "summary",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
  });

  test("rejects an unknown event name", () => {
    const result = saveClientEvents([{ ...envelope("evt_unknown_1"), name: "made_up_event" }]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
  });

  test("PII guard rejects email-like text in query with reason pii-suspected", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_pii_email"),
        name: "search_started",
        query: "gift for jane.doe@example.com under $50",
        mode: "quick",
        entry: "home-search",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(readRejections().at(-1)?.reason).toBe("pii-suspected");
  });

  test("PII guard rejects 10+ digit phone-like text in a free-text prop", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_pii_phone"),
        name: "search_started",
        query: "call me at 415-555-0199-22 about headphones",
        mode: "quick",
        entry: "home-search",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(readRejections().at(-1)?.reason).toBe("pii-suspected");
  });

  test("allows ordinary product queries containing digits", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_ok_digits"),
        name: "search_started",
        query: "iPhone 15 Pro Max 256GB vs Pixel 9 Pro",
        mode: "full",
        entry: "example-chip",
      },
    ]);
    expect(result).toEqual({ accepted: 1, rejected: 0 });
  });

  test("PII guard lets a scanned barcode query through — a UPC is not a phone number", () => {
    // Every GTIN is 12+ digits, so the phone heuristic matched all of them and
    // the scan feature silently emitted no telemetry at all.
    const result = saveClientEvents([
      {
        ...envelope("evt_scan_upc"),
        name: "search_started",
        query: "012345678905",
        mode: "full",
        entry: "scan",
      },
    ]);
    expect(result).toEqual({ accepted: 1, rejected: 0 });
  });

  test("the barcode exemption does not extend to a bad check digit", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_scan_bad_check"),
        name: "search_started",
        query: "012345678906",
        mode: "full",
        entry: "scan",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(readRejections().at(-1)?.reason).toBe("pii-suspected");
  });

  test("the barcode exemption does not extend to digits embedded in a sentence", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_scan_embedded"),
        name: "search_started",
        query: "reach me on 012345678905 for the vacuum",
        mode: "full",
        entry: "scan",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(readRejections().at(-1)?.reason).toBe("pii-suspected");
  });

  test("the barcode exemption does not extend to other events or other props", () => {
    const result = saveClientEvents([
      {
        ...envelope("evt_scan_other_prop"),
        name: "retailer_clicked",
        reportId: "rep_1",
        seller: "012345678905",
        kind: "online",
      },
    ]);
    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(readRejections().at(-1)?.reason).toBe("pii-suspected");
  });

  test("rejected_events stores only id, reason, received_at — never the payload", () => {
    saveServerEvent({
      ...envelope("evt_pii_server"),
      name: "search_started",
      query: "email me: leak@example.com",
      mode: "quick",
      entry: "home-search",
    });
    const rejections = readRejections();
    const last = rejections.at(-1);
    expect(last?.reason).toBe("pii-suspected");
    expect(Object.keys(last ?? {}).sort()).toEqual(["id", "reason", "received_at"]);
    expect(JSON.stringify(rejections)).not.toContain("leak@example.com");
  });

  test("saveServerEvent stores a valid event", () => {
    const before =
      getEventCounts().find((row) => row.name === "source_clicked")?.count ?? 0;
    saveServerEvent({
      ...envelope("evt_server_ok"),
      name: "source_clicked",
      reportId: "r1",
      sourceId: "s2",
      sourceClass: "retailer",
    });
    const after = getEventCounts().find((row) => row.name === "source_clicked")?.count ?? 0;
    expect(after).toBe(before + 1);
  });
});
