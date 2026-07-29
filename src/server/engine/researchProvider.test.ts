import { describe, expect, it, vi } from "vitest";
import { GeminiError } from "../gemini";
import { KimiError } from "../kimi";
import {
  isFallbackWorthy,
  otherProvider,
  withFallback,
  type ProviderPair,
  type ResearchProvider,
} from "./researchProvider";

const stub = (id: "kimi" | "gemini", grounded: () => Promise<never> | Promise<{ text: string }>): ResearchProvider =>
  ({ id, model: `${id}-model`, grounded, json: vi.fn() }) as unknown as ResearchProvider;

describe("otherProvider", () => {
  it("pairs each provider with its backup", () => {
    expect(otherProvider("kimi")).toBe("gemini");
    expect(otherProvider("gemini")).toBe("kimi");
  });
});

describe("isFallbackWorthy", () => {
  it("does not retry an auth failure elsewhere — a bad key stays bad", () => {
    expect(isFallbackWorthy(new KimiError("auth", "bad key", false))).toBe(false);
  });

  it("retries quota, timeout and upstream failures on the other provider", () => {
    expect(isFallbackWorthy(new KimiError("quota", "no balance", false))).toBe(true);
    expect(isFallbackWorthy(new KimiError("timeout", "slow", true))).toBe(true);
    expect(isFallbackWorthy(new GeminiError("upstream", "500", true))).toBe(true);
  });
});

describe("withFallback", () => {
  const ok = (text: string) => vi.fn().mockResolvedValue({ text });

  it("uses the primary when it succeeds and never touches the backup", async () => {
    const primaryFn = ok("primary");
    const backupFn = ok("backup");
    const pair = { primary: stub("kimi", primaryFn), backup: stub("gemini", backupFn) } as ProviderPair;
    const out = await withFallback(pair, (p) => p.grounded("q"));
    expect(out).toEqual({ text: "primary" });
    expect(backupFn).not.toHaveBeenCalled();
  });

  it("falls back and reports the switch so the report can attribute quality", async () => {
    const primaryFn = vi.fn().mockRejectedValue(new KimiError("timeout", "slow", true));
    const backupFn = ok("backup");
    const pair = { primary: stub("kimi", primaryFn), backup: stub("gemini", backupFn) } as ProviderPair;
    const seen: string[] = [];
    const out = await withFallback(pair, (p) => p.grounded("q"), (from, to) => seen.push(`${from}->${to}`));
    expect(out).toEqual({ text: "backup" });
    expect(seen).toEqual(["kimi->gemini"]);
  });

  it("does not fall back on an auth error", async () => {
    const backupFn = ok("backup");
    const pair = {
      primary: stub("kimi", vi.fn().mockRejectedValue(new KimiError("auth", "bad key", false))),
      backup: stub("gemini", backupFn),
    } as ProviderPair;
    await expect(withFallback(pair, (p) => p.grounded("q"))).rejects.toThrow(KimiError);
    expect(backupFn).not.toHaveBeenCalled();
  });

  it("rethrows the PRIMARY error when both fail — it describes the configured engine", async () => {
    const pair = {
      primary: stub("kimi", vi.fn().mockRejectedValue(new KimiError("timeout", "primary boom", true))),
      backup: stub("gemini", vi.fn().mockRejectedValue(new GeminiError("upstream", "backup boom", true))),
    } as ProviderPair;
    await expect(withFallback(pair, (p) => p.grounded("q"))).rejects.toThrow("primary boom");
  });

  it("propagates the failure when fallback is disabled", async () => {
    const pair = {
      primary: stub("kimi", vi.fn().mockRejectedValue(new KimiError("timeout", "boom", true))),
      backup: null,
    } as ProviderPair;
    await expect(withFallback(pair, (p) => p.grounded("q"))).rejects.toThrow("boom");
  });
});
