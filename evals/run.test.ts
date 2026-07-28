import { describe, expect, it } from "vitest";
import { gradeAssumptions, gradeProse } from "./run";
import type { Report } from "../src/shared/report";

/**
 * Guards the robust "sensible assumptions" grading (M5). It must PASS
 * decision-relevant assumptions phrased with synonyms and FAIL tautological
 * query-restatements / query-agnostic filler — the exact failure the eval
 * harness caught and the classify v1.2.0 fix + this check together resolved.
 */
function reportWith(assumptions: string[]): Report {
  return {
    assumptions: assumptions.map((text, i) => ({
      id: `a${i}`,
      text,
      origin: "inferred",
      affirmed: true,
    })),
  } as unknown as Report;
}

const monitorCase = {
  query: "best budget 27 inch monitor for working from home",
  expect: { assumptionHints: ["budget", "1440", "4k", "office", "productiv"] },
};

describe("gradeAssumptions", () => {
  it("passes decision-relevant assumptions even when phrased with synonyms", () => {
    const r = reportWith([
      "You are looking for a new monitor to use primarily for work tasks.",
      "You prioritize affordability, seeking good value for its price.",
      "A 27-inch screen size is a key requirement for your workspace.",
      "You want comfortable viewing for long hours at a desk.",
    ]);
    // "affordability"/"value" (not literally "budget"), "work", "size" → vocab hits.
    expect(gradeAssumptions(r, monitorCase).pass).toBe(true);
  });

  it("fails tautological restatements + query-agnostic filler", () => {
    const r = reportWith([
      "You are looking for a MacBook Air M4 13 inch.",
      "You are considering a purchase in the near future.",
      "You are likely in a region where it is readily available.",
      "You want a good product.",
    ]);
    expect(
      gradeAssumptions(r, {
        query: "MacBook Air M4 13 inch",
        expect: { assumptionHints: ["battery", "portab", "performance"] },
      }).pass,
    ).toBe(false);
  });

  it("fails when there are too few assumptions", () => {
    const r = reportWith(["You prioritize battery life and portability."]);
    expect(gradeAssumptions(r, monitorCase).pass).toBe(false);
  });
});

describe("gradeProse", () => {
  const base = (rationale: string, whyBest: string) =>
    ({
      verdict: { rationale },
      bestFit: { whyBest },
    }) as unknown as Parameters<typeof gradeProse>[0];

  // Regression (owner report 2026-07-28): a 90-word third-person rationale
  // shipped live and no check in this suite could see it.
  it("fails the analyst-memo voice", () => {
    const r = gradeProse(base("The user seeks a lightweight laptop for their stated use cases.", "It fits."));
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("third-person");
  });

  it("fails a word wall", () => {
    const wall = Array.from({ length: 70 }, (_, i) => `word${i}`).join(" ");
    const r = gradeProse(base(wall, "It fits."));
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("rationale 70w");
  });

  it("passes concise second-person prose", () => {
    const r = gradeProse(
      base(
        "You asked about the M4, but the M5 is the one to buy — same body, faster chip, 18-hour battery.",
        "The fanless design means it stays silent under the loads you described.",
      ),
    );
    expect(r.pass).toBe(true);
    expect(r.detail).toContain("second person");
  });
});
