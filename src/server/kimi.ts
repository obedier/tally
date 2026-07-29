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
/**
 * Generous because k2.6 is a reasoning model: a real audit spent 1200 reasoning
 * tokens and ~23s. A tighter bound would time out on every successful call.
 */
const TIMEOUT_MS = 45_000;
const MAX_RETRIES = 1;
const BACKOFF_MS = 700;
/**
 * Kimi k2.6 rejects any temperature but 1 ("only 1 is allowed for this model"),
 * unlike Gemini which we pin to 0. So this provider's output is not
 * deterministic and cannot be made so — worth remembering when its verdicts
 * look inconsistent across otherwise identical runs.
 */
const TEMPERATURE = 1;

/** Token counts as reported by the API. Reasoning tokens bill as output. */
export type KimiUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type KimiErrorCode = "rate-limited" | "quota" | "auth" | "upstream" | "network" | "timeout" | "parse";

export class KimiError extends Error {
  constructor(
    readonly code: KimiErrorCode,
    message: string,
    readonly retryable: boolean,
    /**
     * Tokens the failed call still consumed. A reply that burns 2000 reasoning
     * tokens and then fails to parse is billed exactly like one that succeeded,
     * so dropping this would understate unit economics at the worst moment.
     */
    readonly usage: KimiUsage = { inputTokens: 0, outputTokens: 0 },
  ) {
    super(message);
    this.name = "KimiError";
  }
}

/**
 * Reasoning tokens are billed against max_tokens and are NOT visible in the
 * content. At 200 the model spent the whole budget thinking and returned an
 * empty string with finish_reason "length"; 1500 still truncated; 3000 leaves
 * room for ~1200 reasoning tokens plus the answer. Do not lower this.
 */
const DEFAULT_MAX_TOKENS = 3000;

export type KimiOptions = {
  readonly apiKey: string;
  readonly model: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
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

async function requestOnce(opts: KimiOptions): Promise<{ text: string; usage: KimiUsage }> {
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
          max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
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
    return {
      text,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        // completion_tokens already includes reasoning tokens on k2.6.
        outputTokens: parsed.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Kimi and parses its output. Retries only errors marked retryable —
 * an auth failure or an exhausted balance is retried zero times.
 */
export type KimiResult<T> = { readonly data: T; readonly usage: KimiUsage };

export async function callKimi<T>(
  opts: KimiOptions,
  parse: (text: string) => T,
): Promise<KimiResult<T>> {
  let lastError = new KimiError("network", "Kimi call was not attempted", true);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) await sleep(BACKOFF_MS * 2 ** (attempt - 1));
    try {
      const { text, usage } = await requestOnce(opts);
      try {
        return { data: parse(text), usage };
      } catch (err) {
        // Carry the usage onto the error: those tokens were spent regardless.
        throw err instanceof KimiError
          ? new KimiError(err.code, err.message, err.retryable, usage)
          : new KimiError("parse", "Kimi output failed validation", true, usage);
      }
    } catch (err) {
      lastError = err instanceof KimiError ? err : new KimiError("network", "Unexpected Kimi client error", true);
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}
