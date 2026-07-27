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
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_FAST_MODEL = "gemini-2.5-flash-lite";

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
  return {
    geminiApiKey: rawKey.trim() === "" ? null : rawKey.trim(),
    geminiModel: rawModel.trim() === "" ? DEFAULT_MODEL : rawModel.trim(),
    geminiFastModel: rawFastModel.trim() === "" ? DEFAULT_FAST_MODEL : rawFastModel.trim(),
  };
}
