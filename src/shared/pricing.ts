/**
 * Model cost estimation, for projecting unit economics from real usage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE RATES ARE OPERATOR-MAINTAINED ESTIMATES, NOT BILLING DATA.
 * Provider prices change without notice and are not fetched at runtime.
 * Verify against the provider's console before making a pricing or funding
 * decision, and correct them here (or via TALLY_PRICING_JSON) when they move.
 * Every figure derived from this file must be labelled an estimate wherever it
 * is shown — the same honesty rule the product applies to its own claims.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The non-obvious part: for a grounded research engine, TOKENS ARE USUALLY NOT
 * THE DOMINANT COST. Google Search grounding is billed per request, and one
 * full-mode research issues up to three grounded calls. A single grounded
 * request can cost more than every token in the report combined, which is why
 * `groundedRequests` is tracked as a first-class quantity rather than folded
 * into token math.
 */

export type ModelRate = {
  /** USD per million input tokens. */
  readonly inputPerMtok: number;
  /** USD per million output tokens (reasoning tokens bill as output). */
  readonly outputPerMtok: number;
  /**
   * USD per grounded search call. Providers differ by 7x — Google Search
   * grounding is billed per request, while Moonshot's `$web_search` charges
   * $0.005 per call ON TOP of billing the retrieved pages as input tokens.
   * Omitted means GROUNDED_REQUEST_USD (the Google rate).
   */
  readonly searchPerCall?: number;
};

/** Moonshot's published `$web_search` charge, separate from token billing. */
export const KIMI_SEARCH_USD = 0.005;

/**
 * Rates by model id. Unknown models fall back to FALLBACK_RATE rather than
 * silently costing zero — a missing entry must never read as "free".
 */
export const MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  "gemini-3.5-flash": { inputPerMtok: 0.3, outputPerMtok: 2.5 },
  "gemini-3.5-flash-lite": { inputPerMtok: 0.1, outputPerMtok: 0.4 },
  "gemini-2.5-flash": { inputPerMtok: 0.3, outputPerMtok: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMtok: 0.1, outputPerMtok: 0.4 },
  // Moonshot rates verified against published pricing 2026-07-29.
  // NOTE: "-highspeed" is the SAME model served faster at DOUBLE the price.
  // It is our default research model, so this is the rate that matters most —
  // it was previously hitting FALLBACK_RATE and understating output by ~3.2x.
  "kimi-k2.7-code-highspeed": { inputPerMtok: 1.9, outputPerMtok: 8.0, searchPerCall: KIMI_SEARCH_USD },
  "kimi-k2.7-code": { inputPerMtok: 0.95, outputPerMtok: 4.0, searchPerCall: KIMI_SEARCH_USD },
  // k2.6/k3 rates are less certain than the k2.7 pair; re-verify before basing
  // a funding decision on them.
  "kimi-k2.6": { inputPerMtok: 0.6, outputPerMtok: 2.5, searchPerCall: KIMI_SEARCH_USD },
  "kimi-k3": { inputPerMtok: 3.0, outputPerMtok: 15.0, searchPerCall: KIMI_SEARCH_USD },
};

/** Used when a model id has no entry. Deliberately not zero. */
export const FALLBACK_RATE: ModelRate = { inputPerMtok: 0.5, outputPerMtok: 2.5 };

/**
 * USD per grounded (Google Search) request. Historically billed per request
 * above a free daily tier; the free tier is NOT modelled here, so totals are a
 * conservative upper bound at low volume and accurate at scale.
 */
export const GROUNDED_REQUEST_USD = 0.035;

export type UsageTotals = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly groundedRequests: number;
};

/** Rate for a model id, falling back rather than returning zero. */
export function rateFor(model: string): ModelRate {
  return MODEL_RATES[model] ?? FALLBACK_RATE;
}

/** Estimated USD for one model's usage. Never negative; never silently zero. */
export function estimateCostUsd(model: string, usage: UsageTotals): number {
  const rate = rateFor(model);
  const tokens =
    (Math.max(0, usage.inputTokens) / 1_000_000) * rate.inputPerMtok +
    (Math.max(0, usage.outputTokens) / 1_000_000) * rate.outputPerMtok;
  const grounding = Math.max(0, usage.groundedRequests) * (rate.searchPerCall ?? GROUNDED_REQUEST_USD);
  return tokens + grounding;
}

/** Rounds to a cent-fraction that survives JSON without float noise. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}
