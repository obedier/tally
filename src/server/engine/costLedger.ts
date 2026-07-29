/**
 * Per-research cost accounting across every model provider.
 *
 * Exists to answer a business question, not an engineering one: what does one
 * research actually cost, and what does one user cost per month? Those numbers
 * decide whether Tally can be free, freemium, or paid — so they must come from
 * measured usage rather than from a guess about how many tokens a report "feels
 * like". The engine already learned that lesson with product images.
 *
 * Everything here is an ESTIMATE derived from `src/shared/pricing.ts`, whose
 * rates are operator-maintained and not fetched from any billing API. Callers
 * must label it as such wherever it is displayed.
 */

import { estimateCostUsd, roundUsd, type UsageTotals } from "../../shared/pricing";

export type ProviderKey = "gemini" | "kimi";

export type ProviderCost = {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly groundedRequests: number;
  readonly usd: number;
};

export type CostSummary = {
  readonly totalUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Billed per request and often the dominant line item — tracked separately. */
  readonly groundedRequests: number;
  readonly byProvider: Readonly<Partial<Record<ProviderKey, ProviderCost>>>;
};

type Entry = { model: string; inputTokens: number; outputTokens: number; groundedRequests: number };

export type CostLedger = {
  /** Records one model call. Safe to call with zeroed usage. */
  readonly add: (provider: ProviderKey, model: string, usage: Partial<UsageTotals>) => void;
  readonly summary: () => CostSummary;
};

/**
 * A ledger is per-research and mutable by design: it is threaded through a
 * pipeline that already passes a dozen values around, and making every call
 * site return a new immutable total would obscure the code this exists to
 * measure. Nothing outside the run observes it until `summary()`.
 */
export function createCostLedger(): CostLedger {
  const entries = new Map<ProviderKey, Entry>();

  const add: CostLedger["add"] = (provider, model, usage) => {
    const prior = entries.get(provider);
    entries.set(provider, {
      // Last model wins as the label; a run may use both the main and fast
      // model, and the token totals are what the cost is actually built from.
      model: model === "" ? (prior?.model ?? "unknown") : model,
      inputTokens: (prior?.inputTokens ?? 0) + Math.max(0, usage.inputTokens ?? 0),
      outputTokens: (prior?.outputTokens ?? 0) + Math.max(0, usage.outputTokens ?? 0),
      groundedRequests: (prior?.groundedRequests ?? 0) + Math.max(0, usage.groundedRequests ?? 0),
    });
  };

  const summary: CostLedger["summary"] = () => {
    const byProvider: Partial<Record<ProviderKey, ProviderCost>> = {};
    let totalUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let groundedRequests = 0;
    for (const [provider, e] of entries) {
      const usd = roundUsd(estimateCostUsd(e.model, e));
      byProvider[provider] = {
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        groundedRequests: e.groundedRequests,
        usd,
      };
      totalUsd += usd;
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
      groundedRequests += e.groundedRequests;
    }
    return {
      totalUsd: roundUsd(totalUsd),
      inputTokens,
      outputTokens,
      groundedRequests,
      byProvider,
    };
  };

  return { add, summary };
}
