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
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_FAST_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_KIMI_MODEL = "kimi-k2.6";

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
  return {
    geminiApiKey: rawKey.trim() === "" ? null : rawKey.trim(),
    geminiModel: rawModel.trim() === "" ? DEFAULT_MODEL : rawModel.trim(),
    geminiFastModel: rawFastModel.trim() === "" ? DEFAULT_FAST_MODEL : rawFastModel.trim(),
    kimiApiKey: rawKimiKey.trim() === "" ? null : rawKimiKey.trim(),
    kimiModel: rawKimiModel.trim() === "" ? DEFAULT_KIMI_MODEL : rawKimiModel.trim(),
  };
}
