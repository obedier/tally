import { afterEach, describe, expect, it, vi } from "vitest";
import { callKimi, callKimiGrounded, classifyKimiStatus, parseKimiSources, temperatureFor } from "./kimi";

/**
 * Builds a Moonshot-shaped STREAMED completion. Content is split across two
 * frames on purpose: the client must reassemble deltas, and a single-frame
 * fixture would not exercise that.
 */
const completion = (
  content: string,
  finishReason: string,
  usage = { prompt_tokens: 100, completion_tokens: 8000 },
): Response => {
  const mid = Math.floor(content.length / 2);
  const frames = [
    { choices: [{ delta: { content: content.slice(0, mid) } }] },
    { choices: [{ delta: { content: content.slice(mid) }, finish_reason: finishReason }] },
    { choices: [], usage },
  ];
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
};

const bodyOf = (call: unknown[]): Record<string, unknown> =>
  JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyKimiStatus", () => {
  it("marks an exhausted balance as permanent, not worth retrying", () => {
    // This is the live state of the configured account; retrying it would burn
    // the caller's time budget on a guaranteed failure.
    const err = classifyKimiStatus(402, "exceeded_current_quota_error");
    expect(err.code).toBe("quota");
    expect(err.retryable).toBe(false);
  });

  it("marks a bad key as permanent", () => {
    expect(classifyKimiStatus(401, undefined).retryable).toBe(false);
    expect(classifyKimiStatus(401, undefined).code).toBe("auth");
    expect(classifyKimiStatus(403, undefined).code).toBe("auth");
  });

  it("marks a rate limit as retryable — unlike a quota exhaustion", () => {
    const err = classifyKimiStatus(429, undefined);
    expect(err.code).toBe("rate-limited");
    expect(err.retryable).toBe(true);
  });

  it("retries upstream 5xx but not a 4xx client error", () => {
    expect(classifyKimiStatus(503, undefined).retryable).toBe(true);
    expect(classifyKimiStatus(400, undefined).retryable).toBe(false);
  });

  it("never puts the response body into the error message", () => {
    // Error text reaches logs; only the status shape belongs there.
    expect(classifyKimiStatus(400, undefined).message).not.toMatch(/token|key|sk-/i);
  });
});

describe("temperatureFor", () => {
  // The API rejects a mismatched pair outright, so these are not preferences.
  it("pairs non-reasoning mode with the only temperature it allows", () => {
    expect(temperatureFor("none")).toBe(0.6);
  });

  it("pairs every reasoning mode with the only temperature it allows", () => {
    expect(temperatureFor("low")).toBe(1);
    expect(temperatureFor("medium")).toBe(1);
    expect(temperatureFor("high")).toBe(1);
  });
});

describe("truncation is a failure, not a partial result", () => {
  it("rejects an ungrounded answer cut off at the token limit", async () => {
    // Regression: truncated output reads as a complete answer. Accepting it let
    // half-written research reach the report.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completion("{ \"a\": 1", "length")));
    await expect(
      callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p" }, (t) => t),
    ).rejects.toMatchObject({ code: "truncated" });
  });

  it("bills the tokens a truncated call still burned", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completion("cut off", "length")));
    await expect(
      callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p" }, (t) => t),
    ).rejects.toMatchObject({ usage: { inputTokens: 100, outputTokens: 8000 } });
  });

  it("rejects truncated GROUNDED notes instead of reporting them as sourceless", async () => {
    // The exact live failure: SOURCES is last, so truncation removed the
    // citations and the run looked like "Kimi cannot cite" rather than
    // "the answer was cut off". The message must name the real cause.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      completion("FINDINGS\n[q1] Some notes that stop mid-sent", "length"),
    );
    await expect(callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p" })).rejects.toMatchObject({
      code: "truncated",
    });
  });

  it("accepts a complete answer that merely ran close to the limit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      completion("FINDINGS\nSOURCES:\nTitle | https://example.com/a", "stop"),
    );
    const res = await callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p" });
    expect(res.sources).toHaveLength(1);
  });
});

describe("reasoning mode is selected per call type", () => {
  it("never runs the grounded search loop without reasoning", async () => {
    // Without reasoning the model narrates "let me search" instead of emitting
    // a tool call, so the loop ends with zero evidence. "none" must be ignored.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(completion("SOURCES:\nT | https://example.com/a", "stop")));
    await callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p", reasoningEffort: "none" });
    const body = bodyOf(spy.mock.calls[0] as unknown[]);
    expect(body.reasoning_effort).not.toBe("none");
    expect(body.temperature).toBe(temperatureFor(body.reasoning_effort as "low"));
  });

  it("sends a temperature matching whatever reasoning mode it chose", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completion("ok", "stop")));
    await callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p", reasoningEffort: "none" }, (t) => t);
    const body = bodyOf(spy.mock.calls[0] as unknown[]);
    expect(body.reasoning_effort).toBe("none");
    expect(body.temperature).toBe(0.6);
  });

  it("gives the grounded call enough headroom to reach its SOURCES block", async () => {
    // 8000 truncated mid-answer on the live evidence prompt; the citations sit
    // at the very end, so headroom is what makes them reachable.
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(completion("SOURCES:\nT | https://example.com/a", "stop")));
    await callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p" });
    expect(bodyOf(spy.mock.calls[0] as unknown[]).max_tokens).toBeGreaterThanOrEqual(16_000);
  });
});

describe("streaming", () => {
  it("streams every request, so undici never kills a slow call at its own timeout", async () => {
    // Regression: non-streaming completions send no headers until generation
    // finishes, so minute-long research tripped undici's headersTimeout and
    // surfaced as an unattributable `fetch failed`.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(completion("ok", "stop")));
    await callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p" }, (t) => t);
    expect(bodyOf(spy.mock.calls[0] as unknown[]).stream).toBe(true);
  });

  it("reassembles content split across frames", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(completion("FINDINGS then CANDIDATES then more", "stop")),
    );
    const res = await callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p" }, (t) => t);
    expect(res.data).toBe("FINDINGS then CANDIDATES then more");
  });

  it("reads usage from the trailing usage-only frame", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(completion("ok", "stop", { prompt_tokens: 41, completion_tokens: 7 })),
    );
    const res = await callKimi({ apiKey: "k", model: "kimi-k2.6", prompt: "p" }, (t) => t);
    expect(res.usage).toEqual({ inputTokens: 41, outputTokens: 7 });
  });

  it("accumulates a tool call whose arguments arrive in pieces", async () => {
    // The search loop depends on rebuilding these fragments exactly; a broken
    // reassembly means the tool echo is malformed and evidence never arrives.
    const sse = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      const body =
        call === 1
          ? sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t-1", function: { name: "$web_search", arguments: '{"a"' } }] } }] }) +
            sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "tool_calls" }] }) +
            "data: [DONE]\n\n"
          : sse({ choices: [{ delta: { content: "SOURCES:\nT | https://example.com/a" }, finish_reason: "stop" }] }) +
            "data: [DONE]\n\n";
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    });
    const res = await callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p" });
    expect(res.sources).toHaveLength(1);
    // Second request must echo the fully reassembled arguments back.
    const echoed = bodyOf((vi.mocked(globalThis.fetch).mock.calls[1] ?? []) as unknown[]);
    const toolMsg = (echoed.messages as Array<{ role: string; content?: string }>).find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe('{"a":1}');
  });

  it("echoes the builtin_function type back, or the search never runs", async () => {
    // Regression: without `type`, Moonshot does not execute the server-side
    // search. The model then prints `<function_calls>` blocks as prose and the
    // answer comes back fluent, sourceless, and evidence-free — a silent
    // failure that looked like "Kimi cannot cite".
    const sse = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      const body =
        call === 1
          ? sse({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: "t-1", type: "builtin_function", function: { name: "$web_search", arguments: "{}" } },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }) + "data: [DONE]\n\n"
          : sse({ choices: [{ delta: { content: "SOURCES:\nT | https://example.com/a" }, finish_reason: "stop" }] }) +
            "data: [DONE]\n\n";
      return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    });
    await callKimiGrounded({ apiKey: "k", model: "kimi-k2.6", prompt: "p" });
    const echoed = bodyOf((vi.mocked(globalThis.fetch).mock.calls[1] ?? []) as unknown[]);
    const assistant = (echoed.messages as Array<{ role: string; tool_calls?: Array<{ type?: string }> }>).find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.tool_calls?.[0]?.type).toBe("builtin_function");
  });
});

describe("parseKimiSources", () => {
  it("extracts the direct publisher URLs that are Kimi's whole advantage", () => {
    const out = parseKimiSources(
      "SOURCES:\nSony WH-1000XM4 Review | https://recordingnow.com/blog/x\n- Deals | https://www.soundguys.com/deals-139296/",
    );
    expect(out.map((s) => s.uri)).toEqual([
      "https://recordingnow.com/blog/x",
      "https://www.soundguys.com/deals-139296/",
    ]);
    expect(out[0]?.title).toBe("Sony WH-1000XM4 Review");
  });

  it("does not double-count a URL repeated in prose and in SOURCES", () => {
    const out = parseKimiSources("See https://example.com/a for detail.\nSOURCES:\nA | https://example.com/a");
    expect(out).toHaveLength(1);
  });
});
