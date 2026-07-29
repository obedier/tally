import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Server-only environment loading. The Gemini key is read from process.env or
 * a root `.env.local` file and is NEVER logged, echoed, or sent to a client.
 * A missing key surfaces as `geminiApiKey: null`; the engine maps that to the
 * stable "engine-not-configured" error.
 */

export type EngineEnv = {
  readonly geminiApiKey: string | null;
  readonly geminiModel: string;
  /** Cheap/fast model for the classify stage (S1 latency target). */
  readonly geminiFastModel: string;
  /**
   * Second provider (Kimi/Moonshot), used only to cross-check product feedback
   * that Gemini already produced. Null disables the check silently — the second
   * opinion is an enhancement and must never be able to fail a report.
   */
  readonly kimiApiKey: string | null;
  readonly kimiModel: string;
  /**
   * Which provider runs PRIMARY research — the grounded evidence search and the
   * synthesis built on it. Configurable precisely so this can be reverted in
   * one env var if Kimi's quality or its ~2min-per-search latency doesn't hold.
   */
  readonly researchProvider: ResearchProviderId;
  /**
   * Fall back to the other provider when the primary fails outright. On by
   * default: a research that returns nothing is worse than one that costs more.
   */
  readonly researchFallback: boolean;
  /**
   * Cheap model for the independent second-opinion audit. Must NOT be the model
   * that wrote the synthesis — a model auditing its own output is exactly the
   * failure the audit exists to catch.
   */
  readonly auditModel: string;
};

/** Providers that can run grounded research. */
export type ResearchProviderId = "kimi" | "gemini";

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_FAST_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";
/**
 * Gemini is primary by default. The Kimi path is fully built and one env var
 * away (`RESEARCH_PROVIDER=kimi`), but it FAILED its live trial on 2026-07-29
 * for two independent reasons, both measured:
 *
 * 1. Its grounded answers did not reliably carry citations. Moonshot injects
 *    search results server-side and returns no structured chunks, so the model
 *    must print its own SOURCES block; it did so in isolation but not under the
 *    real evidence prompt, producing grounded text with zero citable URLs.
 * 2. Synthesis timed out even at 180s — k2.6 reasons at length before emitting
 *    the large report JSON.
 *
 * Net: a quick research took 450s and still fell back to Gemini for both
 * stages. The attraction is real (~2.7x cheaper per search, and DIRECT
 * publisher URLs instead of vertexaisearch redirect wrappers), so this is worth
 * revisiting — see docs/TODOS.md — but not at the cost of the latency contract
 * and the citation guarantee.
 */
const DEFAULT_RESEARCH_PROVIDER: ResearchProviderId = "gemini";
/** 2.5-flash-lite: ~6x cheaper output than 3.5-flash, and audits are short. */
const DEFAULT_AUDIT_MODEL = "gemini-2.5-flash-lite";

/** Minimal KEY=VALUE parser for .env.local; supports comments and quotes. */
function parseEnvFile(contents: string): Record<string, string> {
  const entries = contents.split("\n").flatMap((rawLine): [string, string][] => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return [];
    const eq = line.indexOf("=");
    if (eq <= 0) return [];
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']/, "")
      .replace(/["']$/, "");
    return key === "" ? [] : [[key, value]];
  });
  return Object.fromEntries(entries);
}

function readLocalEnvFile(): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(resolve(process.cwd(), ".env.local"), "utf8"));
  } catch {
    return {};
  }
}

export function loadEnv(): EngineEnv {
  const local = readLocalEnvFile();
  const rawKey = process.env.GEMINI_API_KEY ?? local.GEMINI_API_KEY ?? "";
  const rawModel = process.env.GEMINI_MODEL ?? local.GEMINI_MODEL ?? "";
  const rawFastModel = process.env.GEMINI_FAST_MODEL ?? local.GEMINI_FAST_MODEL ?? "";
  // KIMI_SHELLY_API_KEY is accepted as an alias because that is the name the
  // key ships under in the operator's shell profile; KIMI_API_KEY wins when set.
  const rawKimiKey =
    process.env.KIMI_API_KEY ??
    process.env.KIMI_SHELLY_API_KEY ??
    local.KIMI_API_KEY ??
    local.KIMI_SHELLY_API_KEY ??
    "";
  const rawKimiModel = process.env.KIMI_MODEL ?? local.KIMI_MODEL ?? "";
  const rawProvider = (process.env.RESEARCH_PROVIDER ?? local.RESEARCH_PROVIDER ?? "").trim().toLowerCase();
  const rawFallback = (process.env.RESEARCH_FALLBACK ?? local.RESEARCH_FALLBACK ?? "").trim().toLowerCase();
  const rawAuditModel = process.env.AUDIT_MODEL ?? local.AUDIT_MODEL ?? "";
  return {
    geminiApiKey: rawKey.trim() === "" ? null : rawKey.trim(),
    geminiModel: rawModel.trim() === "" ? DEFAULT_MODEL : rawModel.trim(),
    geminiFastModel: rawFastModel.trim() === "" ? DEFAULT_FAST_MODEL : rawFastModel.trim(),
    kimiApiKey: rawKimiKey.trim() === "" ? null : rawKimiKey.trim(),
    kimiModel: rawKimiModel.trim() === "" ? DEFAULT_KIMI_MODEL : rawKimiModel.trim(),
    // Anything unrecognised falls back to the default rather than throwing at
    // boot: a typo in an env var must not take the whole engine down.
    researchProvider: rawProvider === "gemini" || rawProvider === "kimi" ? rawProvider : DEFAULT_RESEARCH_PROVIDER,
    researchFallback: rawFallback !== "false" && rawFallback !== "0",
    auditModel: rawAuditModel.trim() === "" ? DEFAULT_AUDIT_MODEL : rawAuditModel.trim(),
  };
}
