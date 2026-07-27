/**
 * Shared in-memory sliding-window rate limiter. Used by the research routes
 * (cost control) and the M4 growth POST endpoints (polls/price-watch — spam and
 * tally-integrity control). Single-process V1; `now` is injected so the logic
 * is pure and unit-testable, and a rejected call consumes neither budget.
 */
export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly maxPerKey: number;
  readonly maxGlobal: number;
}

export function createRateLimiter(opts: RateLimiterOptions) {
  const buckets = new Map<string, number[]>();
  let globalStarts: number[] = [];
  return (key: string, now: number): boolean => {
    // Global backstop first — cannot be bypassed by rotating the client-keyed
    // fields, so it bounds total volume regardless of per-key evasion.
    globalStarts = globalStarts.filter((t) => now - t < opts.windowMs);
    if (globalStarts.length >= opts.maxGlobal) return true;
    const kept = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (kept.length >= opts.maxPerKey) {
      buckets.set(key, kept);
      return true;
    }
    buckets.set(key, [...kept, now]);
    globalStarts.push(now);
    if (buckets.size > 10_000) buckets.clear();
    return false;
  };
}
