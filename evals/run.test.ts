import { describe, expect, it } from "vitest";
import { gradeAssumptions } from "./run";
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
