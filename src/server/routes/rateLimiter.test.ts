import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../rateLimit";

const WINDOW = 10 * 60 * 1000;

describe("createRateLimiter", () => {
  it("allows starts up to the per-key cap, then blocks that key", () => {
    const limited = createRateLimiter({ windowMs: WINDOW, maxPerKey: 3, maxGlobal: 100 });
    const key = "ip:session";
    expect(limited(key, 0)).toBe(false);
    expect(limited(key, 1)).toBe(false);
    expect(limited(key, 2)).toBe(false);
    expect(limited(key, 3)).toBe(true); // 4th within window blocked
  });

  it("global backstop blocks even when every start uses a fresh key", () => {
    // Regression: the per-client key is built from client-controlled fields
    // (sessionId, x-forwarded-for). Rotating them must NOT grant unlimited
    // starts — the global tier has to catch it.
    const limited = createRateLimiter({ windowMs: WINDOW, maxPerKey: 5, maxGlobal: 10 });
    for (let i = 0; i < 10; i++) {
      expect(limited(`rotating-key-${i}`, i)).toBe(false);
    }
    // 11th distinct key would pass the per-key check but the global cap stops it.
    expect(limited("rotating-key-11", 11)).toBe(true);
  });

  it("a rejected start consumes neither the global nor the per-key budget", () => {
    const limited = createRateLimiter({ windowMs: WINDOW, maxPerKey: 1, maxGlobal: 2 });
    expect(limited("a", 0)).toBe(false); // global 1
    expect(limited("a", 1)).toBe(true); // per-key rejected — must not add to global
    expect(limited("b", 2)).toBe(false); // global 2 (proves the reject above didn't count)
    expect(limited("c", 3)).toBe(true); // global cap reached
  });

  it("frees budget as the window slides", () => {
    const limited = createRateLimiter({ windowMs: WINDOW, maxPerKey: 1, maxGlobal: 100 });
    expect(limited("k", 0)).toBe(false);
    expect(limited("k", 100)).toBe(true); // still inside window
    expect(limited("k", WINDOW + 1)).toBe(false); // first start aged out
  });
});
