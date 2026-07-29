/**
 * Provider selection for PRIMARY research — the grounded evidence search and
 * the synthesis built on it.
 *
 * Two providers, one interface, and a fallback. The point of the abstraction is
 * reversibility: switching the engine back to Gemini is one env var
 * (`RESEARCH_PROVIDER=gemini`), not a revert.
 *
 * Why Kimi is the default (owner decision, 2026-07-29):
 * - ~2.7x cheaper per grounded search. Measured: a full Gemini research costs
 *   $0.1673 with 63% of that being per-request Google Search grounding.
 * - It cites DIRECT publisher URLs. Gemini's grounding returns
 *   vertexaisearch redirect wrappers, which is what has been defeating product
 *   image harvesting and degrading source links.
 *
 * What it costs: k2.6 is a reasoning model and one grounded search measured
 * ~120s, against a few seconds for Gemini. Research is minutes, not seconds.
 *
 * The fallback exists because a slow answer beats no answer: if the primary
 * provider fails outright, the other one runs, and the report records which
 * provider actually produced it so quality can be attributed honestly.
 */

import type { EngineEnv, ResearchProviderId } from "../env";
import { callGemini, extractJson, GeminiError, type GroundingChunk } from "../gemini";
import { callKimi, callKimiGrounded, KimiError } from "../kimi";

export type ProviderUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly groundedRequests: number;
};

export type GroundedResult = {
  readonly text: string;
  readonly sources: readonly GroundingChunk[];
  readonly usage: ProviderUsage;
  /** Which provider actually answered — may differ from the configured one. */
  readonly provider: ResearchProviderId;
};

export type JsonResult<T> = {
  readonly data: T;
  readonly usage: ProviderUsage;
  readonly provider: ResearchProviderId;
};

const NO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0, groundedRequests: 0 };

export type ResearchProvider = {
  readonly id: ResearchProviderId;
  readonly model: string;
  /** Grounded web research returning free text plus the URLs it cited. */
  readonly grounded: (prompt: string) => Promise<GroundedResult>;
  /** Ungrounded call whose output must parse as JSON. */
  readonly json: <T>(prompt: string, parse: (text: string) => T, timeoutMs?: number) => Promise<JsonResult<T>>;
};

function geminiProvider(env: EngineEnv, apiKey: string): ResearchProvider {
  return {
    id: "gemini",
    model: env.geminiModel,
    grounded: async (prompt) => {
      const res = await callGemini({ apiKey, model: env.geminiModel, grounded: true, prompt }, (t) => t);
      return {
        text: res.data,
        sources: res.sources,
        usage: { ...res.usage },
        provider: "gemini",
      };
    },
    json: async (prompt, parse, timeoutMs) => {
      const res = await callGemini(
        {
          apiKey,
          model: env.geminiModel,
          grounded: false,
          prompt,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        parse,
      );
      return { data: res.data, usage: { ...res.usage }, provider: "gemini" };
    },
  };
}

function kimiProvider(env: EngineEnv, apiKey: string): ResearchProvider {
  return {
    id: "kimi",
    model: env.kimiModel,
    grounded: async (prompt) => {
      const res = await callKimiGrounded({ apiKey, model: env.kimiModel, prompt });
      // A grounded answer with no citations is not evidence. Treating it as a
      // failure lets the fallback produce a sourced report instead of shipping
      // a confident verdict backed by nothing, which the no-fabrication rule
      // forbids outright.
      if (res.sources.length === 0) {
        throw new KimiError("parse", "Kimi returned grounded text with no citable sources", true, res.usage);
      }
      return {
        text: res.text,
        sources: res.sources.map((s) => ({ title: s.title, uri: s.uri })),
        // Kimi bills search as tokens, not per request. Counting a grounded
        // request here anyway would double-charge it in the cost ledger.
        usage: { ...res.usage, groundedRequests: 0 },
        provider: "kimi",
      };
    },
    json: async (prompt, parse, timeoutMs) => {
      const res = await callKimi(
        {
          apiKey,
          model: env.kimiModel,
          prompt,
          // Synthesis JSON is large and k2.6 reasons before emitting: the 45s
          // default timed out on the first live run and fell back to Gemini.
          ...(timeoutMs === undefined ? {} : { timeoutMs: Math.max(timeoutMs, 180_000) }),
          maxTokens: 16_000,
        },
        (text) => parse(text),
      );
      return {
        data: res.data,
        usage: { ...res.usage, groundedRequests: 0 },
        provider: "kimi",
      };
    },
  };
}

/** Builds a provider by id, or null when its credentials are absent. */
export function buildProvider(id: ResearchProviderId, env: EngineEnv): ResearchProvider | null {
  if (id === "kimi") {
    return env.kimiApiKey === null ? null : kimiProvider(env, env.kimiApiKey);
  }
  return env.geminiApiKey === null ? null : geminiProvider(env, env.geminiApiKey);
}

export const otherProvider = (id: ResearchProviderId): ResearchProviderId =>
  id === "kimi" ? "gemini" : "kimi";

export type ProviderPair = {
  readonly primary: ResearchProvider;
  /** Null when fallback is disabled or the other provider has no credentials. */
  readonly backup: ResearchProvider | null;
};

/**
 * Resolves the configured primary and its backup. Falls back to whichever
 * provider IS configured when the preferred one has no key, so a missing Kimi
 * key degrades to Gemini research rather than to no research at all.
 */
export function resolveProviders(env: EngineEnv): ProviderPair | null {
  const preferred = buildProvider(env.researchProvider, env);
  const alternate = buildProvider(otherProvider(env.researchProvider), env);
  const primary = preferred ?? alternate;
  if (primary === null) return null;
  const backup = env.researchFallback ? (primary === preferred ? alternate : null) : null;
  return { primary, backup };
}

/** True for failures where trying the other provider is worth the time. */
export function isFallbackWorthy(err: unknown): boolean {
  if (err instanceof KimiError) {
    // An auth/quota problem will not fix itself; everything else might be this
    // provider having a bad minute, which the other one may not be having.
    return err.code !== "auth";
  }
  if (err instanceof GeminiError) return true;
  return true;
}

/**
 * Runs `attempt` on the primary, and on the backup if the primary fails in a
 * way worth retrying elsewhere. Both failing rethrows the PRIMARY's error,
 * because that is the one describing the configured engine.
 */
export async function withFallback<T>(
  pair: ProviderPair,
  attempt: (provider: ResearchProvider) => Promise<T>,
  onFallback?: (from: ResearchProviderId, to: ResearchProviderId, err: unknown) => void,
): Promise<T> {
  try {
    return await attempt(pair.primary);
  } catch (err) {
    if (pair.backup === null || !isFallbackWorthy(err)) throw err;
    onFallback?.(pair.primary.id, pair.backup.id, err);
    try {
      return await attempt(pair.backup);
    } catch {
      throw err;
    }
  }
}

export { NO_USAGE, extractJson };
