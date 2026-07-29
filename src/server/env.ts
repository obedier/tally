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
/**
 * k2.7-code-highspeed, not k2.6, and measured rather than assumed: on the real
 * grounded evidence prompt it returned the same sections and comparable
 * citations in 30.6s against k2.6's 393.6s (12.9x), taking an end-to-end quick
 * research from 442s to 74s. It also stopped the mid-answer drift into Chinese
 * that k2.6 exhibited. The "code" in the name is misleading for our use — the
 * grounded research and JSON stages are exactly what it is good at.
 *
 * Not kimi-k3: it emits a `$web_search` tool call and then rejects that same
 * call echoed back verbatim ("Invalid request: tokenization failed"), so it
 * cannot complete a grounded search loop at all. Verified against five
 * different echo shapes, streaming and not — it is a k3-side limitation, not
 * ours. k3 works fine for ungrounded JSON, which is not where the time goes.
 *
 * Reasoning is NOT optional on this family (the API answers "only type=enabled
 * is allowed"); the client detects that from the rejection and adapts, so
 * changing this value to a model with different rules does not need a code
 * change.
 */
const DEFAULT_KIMI_MODEL = "kimi-k2.7-code-highspeed";
/**
 * Gemini is primary by default — for LATENCY only. Kimi-only research now WORKS
 * end to end and is one env var away:
 *
 *   RESEARCH_PROVIDER=kimi        # every stage runs on Kimi
 *   RESEARCH_FALLBACK=false       # optional: no Gemini rescue, truly single-model
 *   KIMI_API_KEY=sk-...           # (KIMI_SHELLY_API_KEY is accepted too)
 *
 * Verified live 2026-07-29: a quick research returned a complete report with 5
 * sources, all DIRECT publisher URLs (cnet.com, rtings.com) rather than
 * Gemini's vertexaisearch redirect wrappers, with confidence honestly capped at
 * medium. The earlier "Kimi cannot cite" diagnosis was wrong; the real causes
 * were an output limit truncating the trailing SOURCES block, and a dropped
 * `type: "builtin_function"` that stopped the search from ever running.
 *
 * What still keeps it off by default is SPEED, and only speed: that run took
 * 442s, 89% of it in the single grounded evidence call, against seconds for
 * Gemini. Flipping this trades a ~30s research for a ~7min one. See
 * docs/TODOS.md item 11 before changing the default.
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
