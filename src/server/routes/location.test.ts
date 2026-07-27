import { describe, expect, it } from "vitest";
import { parseSeedAssumptions, resolveLocation } from "./research";

/**
 * Unit tests for coarse location resolution (M3 gate 2). Verifies the
 * user > ip-header > default precedence and the privacy guarantee that only
 * coarse (region/country/city-name) granularity is ever produced.
 */

describe("resolveLocation", () => {
  it("uses an explicit user location as source 'user' (takes precedence over headers)", () => {
    const loc = resolveLocation("Austin, TX", { country: "US", city: "Seattle" });
    expect(loc).toEqual({ label: "Austin, TX", source: "user" });
  });

  it("derives an 'ip' location from coarse geo headers, coarsest-last", () => {
    const loc = resolveLocation(undefined, { country: "US", region: "WA", city: "Seattle" });
    expect(loc).toEqual({ label: "Seattle, WA, US", source: "ip" });
  });

  it("falls back to a labeled default when no user input and no headers", () => {
    expect(resolveLocation(undefined, {})).toEqual({ label: "United States", source: "default" });
    expect(resolveLocation("", {})).toEqual({ label: "United States", source: "default" });
  });

  it("uses whatever coarse header is present (country-only)", () => {
    expect(resolveLocation(undefined, { country: "US" })).toEqual({ label: "US", source: "ip" });
  });

  it("caps the label length so nothing precise or oversized leaks through", () => {
    const long = "x".repeat(500);
    const loc = resolveLocation(long, {});
    expect(loc.source).toBe("user");
    expect(loc.label.length).toBeLessThanOrEqual(120);
  });
});

describe("parseSeedAssumptions (M3 — cap-and-filter, don't drop wholesale)", () => {
  it("returns [] for non-array input", () => {
    expect(parseSeedAssumptions(undefined)).toEqual([]);
    expect(parseSeedAssumptions("nope")).toEqual([]);
    expect(parseSeedAssumptions({ text: "x", affirmed: true })).toEqual([]);
  });

  it("keeps valid items and drops only the malformed ones (no wholesale loss)", () => {
    const raw = [
      { text: "You want under $300.", affirmed: true },
      { text: "", affirmed: true }, // invalid: empty
      { text: "Brand matters.", affirmed: false },
      { affirmed: true }, // invalid: missing text
      { text: 42, affirmed: true }, // invalid: non-string
    ];
    expect(parseSeedAssumptions(raw)).toEqual([
      { text: "You want under $300.", affirmed: true },
      { text: "Brand matters.", affirmed: false },
    ]);
  });

  it("caps at 8 valid items", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ text: `seed ${i}`, affirmed: true }));
    expect(parseSeedAssumptions(raw)).toHaveLength(8);
  });
});
