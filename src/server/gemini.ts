/**
 * Thin Gemini REST v1beta client (fetch only, no SDK).
 * - Key travels in the `x-goog-api-key` HEADER, never the URL.
 * - Ungrounded calls use JSON mode (responseMimeType: application/json).
 * - Grounded calls use tools:[{googleSearch:{}}]; responseMimeType cannot be
 *   combined with googleSearch, so grounded prompts ask for JSON and the
 *   caller extracts it from text.
 * - Per-call timeout via AbortController; 2 retries with exponential backoff
 *   on 429 / 5xx / network / timeout / parse failures.
 * Error messages never contain upstream response bodies or key material.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const UNGROUNDED_TIMEOUT_MS = 25_000;
const GROUNDED_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 800;
const TEMPERATURE = 0.2;

export type GroundingChunk = { readonly title: string; readonly uri: string };

export type GeminiOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly grounded: boolean;
  readonly timeoutMs?: number;
};

/** Token counts as reported by the API; absent fields count as 0, never guessed. */
export type GeminiUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 1 when this call used Google Search grounding — billed per request. */
  readonly groundedRequests: number;
};

export type GeminiResult<T> = {
  readonly data: T;
  readonly sources: GroundingChunk[];
  readonly retries: number;
  readonly usage: GeminiUsage;
};

export type GeminiErrorCode = "rate-limited" | "upstream" | "network" | "timeout" | "parse";

export class GeminiError extends Error {
  constructor(
    readonly code: GeminiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

type GenerateContentResponse = {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** Reasoning tokens, billed as output. Absent on non-thinking models. */
    thoughtsTokenCount?: number;
  };
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { title?: string; uri?: string } }>;
    };
  }>;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function requestOnce(
  opts: GeminiOptions,
): Promise<{ text: string; sources: GroundingChunk[]; usage: GeminiUsage }> {
  const timeoutMs = opts.timeoutMs ?? (opts.grounded ? GROUNDED_TIMEOUT_MS : UNGROUNDED_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: TEMPERATURE,
        ...(opts.grounded ? {} : { responseMimeType: "application/json" }),
      },
      ...(opts.grounded ? { tools: [{ googleSearch: {} }] } : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${encodeURIComponent(opts.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new GeminiError("timeout", `Gemini call timed out after ${timeoutMs}ms`, true);
      }
      throw new GeminiError("network", "Network error calling Gemini", true);
    }

    if (!res.ok) {
      // Drain the body but never surface it (no upstream bodies in errors).
      await res.text().catch(() => "");
      if (res.status === 429) throw new GeminiError("rate-limited", "Gemini returned HTTP 429", true);
      if (res.status >= 500) throw new GeminiError("upstream", `Gemini returned HTTP ${res.status}`, true);
      throw new GeminiError("upstream", `Gemini returned HTTP ${res.status}`, false);
    }

    let payload: GenerateContentResponse;
    try {
      payload = (await res.json()) as GenerateContentResponse;
    } catch {
      throw new GeminiError("parse", "Gemini response body was not valid JSON", true);
    }

    const candidate = payload.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (text.trim() === "") {
      throw new GeminiError("parse", "Gemini response contained no text", true);
    }
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? []).flatMap((chunk) => {
      const web = chunk.web;
      return web?.uri ? [{ title: web.title ?? "", uri: web.uri }] : [];
    });
    const meta = payload.usageMetadata;
    // Reasoning ("thoughts") tokens bill as output; folding them in here keeps
    // every downstream cost figure honest for thinking-enabled models.
    const usage: GeminiUsage = {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      groundedRequests: opts.grounded === true ? 1 : 0,
    };
    return { text, sources, usage };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Gemini and validates the text output through `parse`. A throwing
 * `parse` counts as a retryable parse failure. `retries` reports how many
 * retries were consumed for the successful attempt.
 */
export async function callGemini<T>(
  opts: GeminiOptions,
  parse: (text: string) => T,
): Promise<GeminiResult<T>> {
  let lastError = new GeminiError("network", "Gemini call was not attempted", true);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    try {
      const { text, sources, usage } = await requestOnce(opts);
      let data: T;
      try {
        data = parse(text);
      } catch (err) {
        throw err instanceof GeminiError
          ? err
          : new GeminiError("parse", "Gemini output failed validation", true);
      }
      return { data, sources, retries: attempt, usage };
    } catch (err) {
      lastError =
        err instanceof GeminiError
          ? err
          : new GeminiError("network", "Unexpected Gemini client error", true);
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}

/**
 * Extracts a JSON object from model text that may include markdown fences or
 * prose around it (required for grounded calls, which cannot use JSON mode).
 */
export function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start !== -1 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    throw new GeminiError("parse", "Could not extract JSON from Gemini output", true);
  }
}
