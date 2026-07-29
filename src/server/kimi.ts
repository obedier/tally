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
 * How much the model may think before answering. This is the single most
 * important knob on this provider, and it is NOT a quality dial — it selects
 * between two materially different machines (all measured 2026-07-29):
 *
 * - "low"/"medium"/"high" — a reasoning model. Reasoning tokens bill against
 *   max_tokens and are invisible in `content` (they arrive in a separate
 *   `reasoning_content` field). REQUIRED for the grounded search loop: without
 *   reasoning the model writes "let me search for X" as prose instead of
 *   emitting the tool call, so the agentic loop dies after one hop.
 * - "none" — a non-reasoning model. Fast and reliable for one-shot JSON, but
 *   useless for tool loops. REQUIRED for synthesis: at "low" effort the
 *   synthesis request reliably dies with a connection-level `fetch failed`,
 *   reproducibly, presumably reasoning past some upstream connection limit.
 *
 * Temperature is COUPLED to this choice by the API, which rejects the pair
 * outright: reasoning modes allow only temperature 1, "none" only 0.6. Never
 * set one without the other — see temperatureFor below.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

const DEFAULT_EFFORT: ReasoningEffort = "low";

/**
 * The API enforces this pairing ("invalid temperature: only 0.6 is allowed for
 * this model"), so it is derived, never configured. A consequence worth
 * remembering: no Kimi mode allows temperature 0, so unlike Gemini (pinned to
 * 0) this provider is non-deterministic and cannot be made otherwise.
 */
export function temperatureFor(effort: ReasoningEffort): number {
  return effort === "none" ? 0.6 : 1;
}

/** Token counts as reported by the API. Reasoning tokens bill as output. */
export type KimiUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type KimiErrorCode =
  | "rate-limited"
  | "quota"
  | "auth"
  | "upstream"
  | "network"
  | "timeout"
  | "parse"
  | "truncated"
  | "reasoning-required";

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
  readonly reasoningEffort?: ReasoningEffort;
};

/**
 * `finish_reason: "length"` means the answer was cut mid-sentence. Accepting it
 * is the trust bug that made Kimi look like it could not cite: the evidence
 * prompt puts SOURCES last, so truncation silently removed exactly the
 * citations while leaving plausible-looking research notes behind. Truncated
 * output is never partial-credit — a half-written report reads as complete.
 */
function assertNotTruncated(finishReason: string | undefined, usage: KimiUsage): void {
  if (finishReason !== "length") return;
  throw new KimiError(
    "truncated",
    "Kimi hit its output limit mid-answer; the result is incomplete",
    true,
    usage,
  );
}

type ToolCall = {
  id: string;
  /**
   * Must be echoed back verbatim — "builtin_function" is what tells Moonshot to
   * RUN the search server-side. Drop it and the search silently never happens;
   * the model then tries to search by printing `<function_calls>` blocks as
   * plain text, and the answer arrives with no evidence and no citations.
   */
  type?: string;
  function?: { name?: string; arguments?: string };
};

type GroundedResponse = {
  choices?: Array<{
    message?: { content?: string; tool_calls?: ToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
};

/** One SSE frame of an OpenAI-compatible streamed completion. */
type StreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type StreamedChoice = {
  readonly content: string;
  readonly toolCalls: ToolCall[];
  readonly finishReason: string | undefined;
  readonly usage: KimiUsage;
};

/**
 * Every Kimi call streams. This is NOT for progressive display — nothing
 * consumes the partial text — it is what makes minute-long calls survive at
 * all.
 *
 * Node's fetch (undici) applies its own `headersTimeout`, independent of and
 * invisible to our AbortController. A NON-streaming completion sends no
 * response headers until the model has finished generating, so a slow research
 * call trips that internal limit and surfaces as a bare `TypeError: fetch
 * failed` / UND_ERR_HEADERS_TIMEOUT — which reads like a network fault and was
 * previously misdiagnosed as Moonshot dropping the connection. Streaming makes
 * headers arrive immediately and each chunk resets the body timer, so the
 * AbortController below is the single, honest owner of the time budget.
 */
async function streamChat(url: string, init: RequestInit, signal: AbortSignal): Promise<StreamedChoice> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    let type: string | undefined;
    let message: string | undefined;
    try {
      const err = ((await res.json()) as GroundedResponse).error;
      type = err?.type;
      // An API validation message ("only type=enabled is allowed for this
      // model") — never request content, so safe to inspect and log.
      message = err?.message;
    } catch {
      /* non-JSON error body: the status alone classifies it */
    }
    throw classifyKimiStatus(res.status, type, message);
  }
  if (res.body === null) throw new KimiError("parse", "Kimi returned no response body", true);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls: ToolCall[] = [];
  let content = "";
  let finishReason: string | undefined;
  let usage: KimiUsage = { inputTokens: 0, outputTokens: 0 };
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are newline-delimited; the last element may be a partial line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      let chunk: StreamChunk;
      try {
        chunk = JSON.parse(payload) as StreamChunk;
      } catch {
        continue; // A malformed frame is not worth failing an otherwise good answer.
      }
      if (chunk.usage !== undefined) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? usage.inputTokens,
          outputTokens: chunk.usage.completion_tokens ?? usage.outputTokens,
        };
      }
      const choice = chunk.choices?.[0];
      if (choice === undefined) continue;
      if (choice.finish_reason != null) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (delta?.content != null) content += delta.content;
      // Tool-call fragments arrive spread across chunks, keyed by index; the
      // name lands once and the arguments accumulate piecewise.
      for (const part of delta?.tool_calls ?? []) {
        const i = part.index ?? 0;
        const existing = toolCalls[i] ?? { id: "", type: undefined, function: { name: "", arguments: "" } };
        toolCalls[i] = {
          id: part.id ?? existing.id,
          // Defaults to the builtin: this loop only ever registers $web_search,
          // and losing the type stops the search from running at all.
          type: part.type ?? existing.type ?? "builtin_function",
          function: {
            name: part.function?.name ?? existing.function?.name ?? "",
            arguments: (existing.function?.arguments ?? "") + (part.function?.arguments ?? ""),
          },
        };
      }
    }
  }
  return { content, toolCalls: toolCalls.filter((c) => c !== undefined), finishReason, usage };
}

/**
 * Maps an HTTP status to a stable code. `quota` is separated from
 * `rate-limited` because they need opposite handling: a rate limit is worth
 * retrying, a suspended/unfunded account never is, and retrying it just burns
 * the caller's time budget on a guaranteed failure.
 */
/**
 * Models disagree about reasoning, and the API states its rules precisely:
 * k2.6/k3 accept `reasoning_effort: "none"` (temperature 0.6), while the k2.7
 * family is reasoning-only and answers "invalid thinking: only type=enabled is
 * allowed for this model" (temperature 1). Rather than hardcode a model list
 * that goes stale with every Moonshot release, we read the constraint off the
 * rejection and remember it for the rest of the process.
 */
const forcedEffort = new Map<string, ReasoningEffort>();

/** True when the upstream 400 says this model cannot disable reasoning. */
function rejectsDisabledReasoning(message: string | undefined): boolean {
  return message !== undefined && /only type=enabled is allowed/i.test(message);
}

export function classifyKimiStatus(status: number, bodyType: string | undefined, bodyMessage?: string): KimiError {
  if (status === 400 && rejectsDisabledReasoning(bodyMessage)) {
    // Retryable: the caller downgrades to a reasoning mode and tries again.
    return new KimiError("reasoning-required", "Kimi model requires reasoning to be enabled", true);
  }
  return classifyStatusOnly(status, bodyType);
}

function classifyStatusOnly(status: number, bodyType: string | undefined): KimiError {
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

/**
 * The requested effort, unless this model has already told us it refuses to
 * disable reasoning. `"low"` is the substitute: it is the cheapest mode such a
 * model will accept.
 */
function effectiveEffort(model: string, requested: ReasoningEffort): ReasoningEffort {
  const forced = forcedEffort.get(model);
  if (forced !== undefined && requested === "none") return forced;
  return requested;
}

async function requestOnce(opts: KimiOptions): Promise<{ text: string; usage: KimiUsage }> {
  const effort = effectiveEffort(opts.model, opts.reasoningEffort ?? DEFAULT_EFFORT);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    let out: StreamedChoice;
    try {
      out = await streamChat(
        `${API_BASE}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify({
            model: opts.model,
            reasoning_effort: effort,
            temperature: temperatureFor(effort),
            max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
            messages: [{ role: "user", content: opts.prompt }],
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
        controller.signal,
      );
    } catch (err) {
      if (err instanceof KimiError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new KimiError(
        aborted ? "timeout" : "network",
        aborted ? "Kimi call timed out" : "Kimi call failed to connect",
        true,
      );
    }

    if (out.content.trim() === "") {
      throw new KimiError("parse", "Kimi returned an empty completion", true, out.usage);
    }
    assertNotTruncated(out.finishReason, out.usage);
    return { text: out.content, usage: out.usage };
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
      if (lastError.code === "reasoning-required") {
        // Learn it once, so every later call on this model skips the rejection
        // instead of paying a failed round trip for it.
        forcedEffort.set(opts.model, "low");
        console.error(`[kimi] ${opts.model} requires reasoning; using effort "low" for this model from now on`);
        continue;
      }
      if (!lastError.retryable) throw lastError;
    }
  }
  throw lastError;
}

/**
 * A grounded research call: Kimi runs Moonshot's `$web_search` builtin, then
 * answers over the retrieved pages.
 *
 * How this differs from Gemini's grounding, and why it matters:
 * - Gemini returns structured `groundingChunks`; Moonshot injects the search
 *   results into the conversation server-side and hands back only a search id.
 *   So the citations must come from the model's own answer, which is why the
 *   evidence prompt is required to end with a SOURCES block.
 * - The URLs Kimi cites are DIRECT publisher links. Gemini's are
 *   vertexaisearch redirect wrappers, which is what has been defeating image
 *   harvesting and source-link quality.
 *
 * Slow by nature: k2.6 reasons over ~9k tokens of search results, measured at
 * ~120s for a single search. Callers must budget for minutes, not seconds.
 */

/**
 * Search results plus reasoning need real headroom. Measured on the live
 * evidence prompt: at 8000 the model spent ~6300 tokens reasoning, emitted 1709
 * characters, and stopped with finish_reason "length" — mid-CANDIDATES, before
 * the SOURCES block. That, not prompt disobedience, is why Kimi appeared unable
 * to cite. At 16000 with "low" effort the same prompt completes with
 * finish_reason "stop" and 25 direct publisher URLs. Do not lower this.
 */
const GROUNDED_MAX_TOKENS = 16_000;
/**
 * Search rounds before the answer is forced. Each round is a full generation
 * measured at ~90-130s in isolation and slower in the pipeline, so this is the
 * dominant latency term: at 3 the real evidence prompt blew a 420s budget
 * twice. 2 means one search round then a forced answer — the exact shape that
 * completed in ~90s standalone and returned 25 direct publisher URLs.
 */
const MAX_TOOL_HOPS = 2;
/**
 * Kimi research is measured in minutes: a 2-question probe took 89s and the
 * real 3-question evidence prompt exceeded 240s. This budget only became safe
 * to raise once the calls were streamed — a non-streaming request dies inside
 * undici at its own headers timeout well before a limit this high is reached,
 * and reports it as an unattributable `fetch failed`.
 */
const GROUNDED_TIMEOUT_MS = 420_000;

const WEB_SEARCH_TOOL = [
  { type: "builtin_function", function: { name: "$web_search" } },
] as const;

/**
 * Closes the search loop. Without this the model keeps trying to search — in
 * prose once the tool is withdrawn — and never produces the notes. It is
 * phrased to protect the citations specifically, because a truncated or
 * abandoned answer loses the trailing SOURCES block first.
 */
const FINAL_ANSWER_INSTRUCTION =
  "Do not search again — searching is finished and no further results will be returned. Using ONLY the search results you have already retrieved, write the complete final answer now in the exact section format requested, ending with the SOURCES: section listing the real URLs you actually used. If the evidence is thin, say so honestly rather than searching for more.";

export type KimiGroundedResult = {
  readonly text: string;
  readonly sources: readonly { title: string; uri: string }[];
  readonly usage: KimiUsage;
  /**
   * Number of `$web_search` calls Moonshot actually executed. Billed at
   * KIMI_SEARCH_USD each, ON TOP of the retrieved pages counting as input
   * tokens — so reporting this as 0 (as we did) understates every Kimi report.
   */
  readonly searchCalls: number;
};

/**
 * Parses the SOURCES block the evidence prompt requires. Lines look like
 * `Title | https://example.com/page`. Bare URLs elsewhere in the answer are a
 * deliberate fallback — a citation the model actually printed is better
 * evidence than none, and downstream code re-validates every URL anyway.
 */
export function parseKimiSources(text: string): { title: string; uri: string }[] {
  const out: { title: string; uri: string }[] = [];
  const seen = new Set<string>();
  const push = (title: string, uri: string): void => {
    const clean = uri.trim().replace(/[)\].,;]+$/, "");
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push({ title: title.trim() === "" ? clean : title.trim(), uri: clean });
  };
  for (const line of text.split("\n")) {
    const piped = line.match(/^\s*[-*\d.\s]*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/i);
    if (piped?.[1] !== undefined && piped[2] !== undefined) {
      push(piped[1], piped[2]);
      continue;
    }
    for (const m of line.matchAll(/https?:\/\/\S+/gi)) push("", m[0]);
  }
  return out;
}

export async function callKimiGrounded(opts: KimiOptions): Promise<KimiGroundedResult> {
  // Reasoning is mandatory here, never "none": the search loop depends on the
  // model emitting a tool call, and the non-reasoning variant narrates its
  // intent to search as prose instead, ending the loop with zero evidence.
  const effort: ReasoningEffort =
    opts.reasoningEffort === undefined || opts.reasoningEffort === "none" ? "low" : opts.reasoningEffort;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GROUNDED_TIMEOUT_MS);
  const messages: unknown[] = [{ role: "user", content: opts.prompt }];
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  // Moonshot bills $web_search per executed call, so count them.
  let searchCalls = 0;
  try {
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop += 1) {
      // On the final hop the tools are withheld so the model MUST answer from
      // what it has already retrieved. Each search round costs ~90-130s, so an
      // open-ended loop blows any sane time budget; and the old behaviour —
      // erroring out when the model still wanted to search — threw away every
      // source it had already gathered. A bounded answer beats a timeout.
      const lastHop = hop === MAX_TOOL_HOPS - 1;
      // Removing the tools is not enough to end the loop: denied the builtin,
      // the model writes `<invoke name="web_search">` blocks as prose and never
      // answers. It has to be told, in the conversation, that searching is over.
      if (lastHop && hop > 0) {
        messages.push({ role: "user", content: FINAL_ANSWER_INSTRUCTION });
      }
      let out: StreamedChoice;
      try {
        out = await streamChat(
          `${API_BASE}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
            body: JSON.stringify({
              model: opts.model,
              reasoning_effort: effort,
              temperature: temperatureFor(effort),
              max_tokens: opts.maxTokens ?? GROUNDED_MAX_TOKENS,
              messages,
              ...(lastHop ? {} : { tools: WEB_SEARCH_TOOL }),
              stream: true,
              stream_options: { include_usage: true },
            }),
          },
          controller.signal,
        );
      } catch (err) {
        if (err instanceof KimiError) {
          throw new KimiError(err.code, err.message, err.retryable, { inputTokens, outputTokens });
        }
        const aborted = err instanceof Error && err.name === "AbortError";
        throw new KimiError(
          aborted ? "timeout" : "network",
          aborted ? "Kimi grounded call timed out" : "Kimi grounded call failed to connect",
          true,
          { inputTokens, outputTokens },
        );
      }
      inputTokens += out.usage.inputTokens;
      outputTokens += out.usage.outputTokens;
      if (process.env.KIMI_DEBUG === "1") {
        console.error(
          `[kimi:debug] hop=${hop} lastHop=${lastHop} finish=${out.finishReason} tools=${out.toolCalls.length} out=${out.usage.outputTokens} len=${out.content.length} t=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
      }

      if (out.finishReason === "tool_calls" && out.toolCalls.length > 0) {
        searchCalls += out.toolCalls.length;
        messages.push({ role: "assistant", content: out.content, tool_calls: out.toolCalls });
        // Moonshot's builtin executes server-side; echoing the arguments back
        // is how the protocol asks us to acknowledge it.
        for (const call of out.toolCalls) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.function?.name ?? "$web_search",
            content: call.function?.arguments ?? "{}",
          });
        }
        continue;
      }

      const choice = { finish_reason: out.finishReason };
      const text = out.content;
      if (text.trim() === "") {
        // Empty content with finish_reason "length" means reasoning consumed
        // the whole budget — a real failure mode of this model, not a fluke.
        throw new KimiError(
          "parse",
          `Kimi grounded answer was empty (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
          true,
          { inputTokens, outputTokens },
        );
      }
      // Checked AFTER the empty case so the emptiness message survives, and
      // before parsing sources: truncated notes lose their trailing SOURCES
      // block, so parsing them would yield "research with no citations"
      // instead of the truthful "the answer was cut off".
      assertNotTruncated(choice?.finish_reason, { inputTokens, outputTokens });
      const sources = parseKimiSources(text);
      if (sources.length === 0 && process.env.KIMI_DEBUG === "1") {
        console.error(
          `[kimi:debug] grounded answer had 0 sources; finish=${choice?.finish_reason} hop=${hop} len=${text.length}\n--- TAIL ---\n${text.slice(-700)}`,
        );
      }
      return { text, sources, usage: { inputTokens, outputTokens }, searchCalls };
    }
    throw new KimiError("upstream", "Kimi kept requesting tools past the hop limit", false, {
      inputTokens,
      outputTokens,
    });
  } finally {
    clearTimeout(timer);
  }
}
