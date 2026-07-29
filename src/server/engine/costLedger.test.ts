import { describe, expect, it } from "vitest";
import { createCostLedger } from "./costLedger";
import { estimateCostUsd, GROUNDED_REQUEST_USD, KIMI_SEARCH_USD, rateFor, FALLBACK_RATE } from "../../shared/pricing";

describe("estimateCostUsd", () => {
  it("prices tokens against the model's rate", () => {
    const usd = estimateCostUsd("gemini-3.5-flash", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      groundedRequests: 0,
    });
    expect(usd).toBeCloseTo(0.3 + 2.5, 6);
  });

  it("bills grounded search per request, not per token", () => {
    const usd = estimateCostUsd("gemini-3.5-flash", {
      inputTokens: 0,
      outputTokens: 0,
      groundedRequests: 3,
    });
    expect(usd).toBeCloseTo(3 * GROUNDED_REQUEST_USD, 6);
  });

  it("makes grounding dominate a realistic report — the whole point of tracking it", () => {
    // A full-mode run: 3 grounded batches plus a few tens of thousands of tokens.
    const usd = estimateCostUsd("gemini-3.5-flash", {
      inputTokens: 40_000,
      outputTokens: 12_000,
      groundedRequests: 3,
    });
    const tokensOnly = estimateCostUsd("gemini-3.5-flash", {
      inputTokens: 40_000,
      outputTokens: 12_000,
      groundedRequests: 0,
    });
    expect(usd - tokensOnly).toBeGreaterThan(tokensOnly * 2);
  });

  it("prices a Kimi search at Moonshot's rate, not Google's", () => {
    // Regression: search cost was global, so a Kimi search was priced at
    // Google's $0.035 — 7x its real $0.005 — and separately the provider
    // hardcoded groundedRequests to 0, billing it at nothing at all.
    const usd = estimateCostUsd("kimi-k2.7-code-highspeed", {
      inputTokens: 0,
      outputTokens: 0,
      groundedRequests: 2,
    });
    expect(usd).toBeCloseTo(2 * KIMI_SEARCH_USD, 6);
    expect(usd).toBeLessThan(2 * GROUNDED_REQUEST_USD);
  });

  it("prices the highspeed variant at double the standard k2.7 rate", () => {
    // "-highspeed" is the same model served faster for twice the money, and it
    // is our default research model — pricing it as standard would understate
    // every Kimi report.
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, groundedRequests: 0 };
    const fast = estimateCostUsd("kimi-k2.7-code-highspeed", usage);
    const standard = estimateCostUsd("kimi-k2.7-code", usage);
    expect(fast).toBeCloseTo(standard * 2, 6);
  });

  it("falls back rather than pricing an unknown model at zero", () => {
    expect(rateFor("some-model-we-never-heard-of")).toEqual(FALLBACK_RATE);
    expect(
      estimateCostUsd("some-model-we-never-heard-of", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        groundedRequests: 0,
      }),
    ).toBeGreaterThan(0);
  });

  it("never returns a negative cost from bad counts", () => {
    expect(
      estimateCostUsd("gemini-3.5-flash", {
        inputTokens: -5,
        outputTokens: -5,
        groundedRequests: -5,
      }),
    ).toBe(0);
  });
});

describe("createCostLedger", () => {
  it("accumulates repeated calls to one provider", () => {
    const ledger = createCostLedger();
    ledger.add("gemini", "gemini-3.5-flash", { inputTokens: 100, outputTokens: 50, groundedRequests: 1 });
    ledger.add("gemini", "gemini-3.5-flash", { inputTokens: 200, outputTokens: 60, groundedRequests: 1 });
    const s = ledger.summary();
    expect(s.inputTokens).toBe(300);
    expect(s.outputTokens).toBe(110);
    expect(s.groundedRequests).toBe(2);
  });

  it("splits cost by provider so each one's share is visible", () => {
    const ledger = createCostLedger();
    ledger.add("gemini", "gemini-3.5-flash", { inputTokens: 40_000, outputTokens: 12_000, groundedRequests: 3 });
    ledger.add("kimi", "kimi-k2.6", { inputTokens: 300, outputTokens: 1200 });
    const s = ledger.summary();
    expect(s.byProvider.gemini?.groundedRequests).toBe(3);
    expect(s.byProvider.kimi?.groundedRequests).toBe(0);
    expect(s.totalUsd).toBeCloseTo((s.byProvider.gemini?.usd ?? 0) + (s.byProvider.kimi?.usd ?? 0), 6);
  });

  it("reports zeroes for a run that made no calls, not an empty object", () => {
    const s = createCostLedger().summary();
    expect(s).toEqual({
      totalUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      groundedRequests: 0,
      byProvider: {},
    });
  });

  it("bills a call that spent tokens and returned nothing usable", () => {
    // A Kimi audit that burns 1200 reasoning tokens then fails to parse still
    // appears on the bill; omitting it would understate unit economics.
    const ledger = createCostLedger();
    ledger.add("kimi", "kimi-k2.6", { inputTokens: 258, outputTokens: 1200 });
    expect(ledger.summary().totalUsd).toBeGreaterThan(0);
  });

  it("tolerates a partial usage object without producing NaN", () => {
    const ledger = createCostLedger();
    ledger.add("gemini", "gemini-3.5-flash", { inputTokens: 10 });
    const s = ledger.summary();
    expect(Number.isFinite(s.totalUsd)).toBe(true);
    expect(s.outputTokens).toBe(0);
    expect(s.groundedRequests).toBe(0);
  });
});
