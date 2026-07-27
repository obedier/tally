import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Set the DB path BEFORE any db function runs (the connection opens lazily).
process.env.TALLY_DB_PATH = join(mkdtempSync(join(tmpdir(), "tally-cache-test-")), "test.db");

import type { CategoryId, Report, ResearchMode } from "../../shared/report";
import { cacheKey, FRESHNESS_WINDOWS_MS, isFresh, lookupFresh, remember } from "./cache";

const HOUR_MS = 60 * 60 * 1000;

/** Minimal Report stub — cache only reads id, category.id, createdAt. */
function report(over: {
  id: string;
  categoryId?: CategoryId;
  createdAt: string;
  query?: string;
}): Report {
  return {
    id: over.id,
    query: over.query ?? "sony wh-1000xm5",
    category: { id: over.categoryId ?? "consumer-electronics", label: "x", confidence: 0.9 },
    createdAt: over.createdAt,
  } as unknown as Report;
}

describe("cacheKey / normalization", () => {
  test("collapses case, whitespace, and punctuation to a stable token", () => {
    expect(cacheKey("Sony WH-1000XM5!", "full")).toBe(cacheKey("  sony   wh 1000xm5 ", "full"));
  });

  test("mode is part of the key — same query, different mode differs", () => {
    expect(cacheKey("best blender", "full")).not.toBe(cacheKey("best blender", "deep"));
  });
});

describe("isFresh (pure, injected clock)", () => {
  const base = Date.parse("2026-07-27T00:00:00.000Z");

  test("fresh strictly inside the window, stale past it", () => {
    const iso = new Date(base).toISOString();
    // consumer-electronics window is 24h.
    expect(isFresh(iso, "consumer-electronics", base + 23 * HOUR_MS)).toBe(true);
    expect(isFresh(iso, "consumer-electronics", base + 25 * HOUR_MS)).toBe(false);
  });

  test("per-category windows differ — home-goods outlives electronics", () => {
    const iso = new Date(base).toISOString();
    const at = base + 48 * HOUR_MS;
    expect(isFresh(iso, "consumer-electronics", at)).toBe(false); // 24h < 48h elapsed
    expect(isFresh(iso, "home-goods", at)).toBe(true); // 72h window still covers it
    expect(FRESHNESS_WINDOWS_MS["home-goods"]).toBeGreaterThan(
      FRESHNESS_WINDOWS_MS["consumer-electronics"],
    );
  });

  test("future createdAt (clock skew) is not trusted", () => {
    const future = new Date(base + HOUR_MS).toISOString();
    expect(isFresh(future, "other", base)).toBe(false);
  });
});

describe("remember -> lookupFresh round-trip", () => {
  const base = Date.parse("2026-07-27T12:00:00.000Z");

  test("stores and returns the reportId within the window", () => {
    const q = "noise cancelling headphones";
    remember(q, "full", report({ id: "rep_hit", createdAt: new Date(base).toISOString() }));
    expect(lookupFresh(q, "full", base + HOUR_MS)).toEqual({ reportId: "rep_hit" });
  });

  test("returns null once past the category window", () => {
    const q = "wireless earbuds";
    remember(q, "full", report({ id: "rep_stale", createdAt: new Date(base).toISOString() }));
    // consumer-electronics: 24h window; 30h later is stale.
    expect(lookupFresh(q, "full", base + 30 * HOUR_MS)).toBeNull();
  });

  test("home-goods reuses longer than electronics for the same elapsed time", () => {
    const q = "stand mixer for small kitchen";
    remember(
      q,
      "deep",
      report({ id: "rep_home", categoryId: "home-goods", createdAt: new Date(base).toISOString() }),
    );
    // 48h later: past the 24h electronics window but inside the 72h home-goods window.
    expect(lookupFresh(q, "deep", base + 48 * HOUR_MS)).toEqual({ reportId: "rep_home" });
  });

  test("normalized-equivalent query hits the same cache entry", () => {
    remember("Robot Vacuum", "full", report({ id: "rep_norm", createdAt: new Date(base).toISOString() }));
    expect(lookupFresh("  robot   vacuum!! ", "full", base + HOUR_MS)).toEqual({
      reportId: "rep_norm",
    });
  });

  test("quick mode is never cached (cheap + volatile)", () => {
    const q = "cheap phone stand";
    remember(q, "quick" as ResearchMode, report({ id: "rep_quick", createdAt: new Date(base).toISOString() }));
    expect(lookupFresh(q, "quick" as ResearchMode, base + 60_000)).toBeNull();
  });

  test("miss on an unseen query returns null", () => {
    expect(lookupFresh("never asked before xyz", "full", base)).toBeNull();
  });
});
