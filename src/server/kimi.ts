/**
 * Kimi (Moonshot) client — the SECOND research provider, after Gemini.
 *
 * Gemini does the research; Kimi is only ever asked to judge work that already
 * exists. That ordering is deliberate: a second opinion is worth something
 * precisely because it did not participate in forming the first one.
 *
 * Failure is always non-fatal. Every caller must treat a null result as "no
 * second opinion available" and ship the report unchanged — a cross-check that
 * can break the primary product is worse than no cross-check. The API key is
 * server-only and is never logged, echoed, or sent to a client.
 *
 * OpenAI-compatible chat-completions surface at api.moonshot.ai.
 */

const API_BASE = "https://api.moonshot.ai/v1";
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;
const BACKOFF_MS = 700;
const TEMPERATURE = 0;

export type KimiErrorCode = "rate-limited" | "quota" | "auth" | "upstream" | "network" | "timeout" | "parse";

export class KimiError extends Error {
  constructor(
    readonly code: KimiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "KimiError";
  }
}

export type KimiOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; type?: string };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Maps an HTTP status to a stable code. `quota` is separated from
 * `rate-limited` because they need opposite handling: a rate limit is worth
 * retrying, a suspended/unfunded account never is, and retrying it just burns
 * the caller's time budget on a guaranteed failure.
 */
export function classifyKimiStatus(status: number, bodyType: string | undefined): KimiError {
  if (status === 401 || status === 403) {
    return new KimiError("auth", "Kimi rejected the API key", false);
  }
  if (bodyType === "exceeded_current_quota_error") {
    return new KimiError("quota", "Kimi account is out of balance", false);
  }
  if (status === 429) {
    return new KimiError("rate-limited", "Kimi is rate-limited", true);
  }
  if (status >= 500) {
    return new KimiError("upstream", `Kimi upstream error (${status})`, true);
  }
  return new KimiError("upstream", `Kimi request failed (${status})`, false);
}

async function requestOnce(opts: KimiOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: TEMPERATURE,
          max_tokens: opts.maxTokens ?? 400,
          messages: [{ role: "user", content: opts.prompt }],
        }),
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new KimiError(
        aborted ? "timeout" : "network",
        aborted ? "Kimi call timed out" : "Kimi call failed to connect",
        true,
      );
    }

    // Read the body once; both the error type and the content live in it.
    let parsed: ChatCompletionResponse;
    try {
      parsed = (await res.json()) as ChatCompletionResponse;
    } catch {
      if (!res.ok) throw classifyKimiStatus(res.status, undefined);
      throw new KimiError("parse", "Kimi returned a non-JSON body", false);
    }
    if (!res.ok) throw classifyKimiStatus(res.status, parsed.error?.type);

    const text = parsed.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.trim() === "") {
      throw new KimiError("parse", "Kimi returned an empty completion", true);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Kimi and parses its output. Retries only errors marked retryable —
 * an auth failure or an exhausted balance is retried zero times.
 */
export async function callKimi<T>(opts: KimiOptions, parse: (text: string) => T): Promise<T> {
  let lastError = new KimiError("network", "Kimi call was not attempted", true);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    try {
      const text = await requestOnce(opts);
      try {
        return parse(text);
      } catch (err) {
        throw err instanceof KimiError
          ? err
          : new KimiError("parse", "Kimi output failed validation", true);
      }
    } catch (err) {
      lastError = err instanceof KimiError ? err : new KimiError("network", "Unexpected Kimi client error", true);
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}
