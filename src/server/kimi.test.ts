import { describe, expect, it } from "vitest";
import { classifyKimiStatus } from "./kimi";

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
