import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { corsMiddleware, isAllowedOrigin, parseExtraOrigins } from "./cors";

function appWith(extra: readonly string[] = []) {
  const app = new Hono();
  app.use("/api/*", corsMiddleware(extra));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/events", (c) => c.json({ ok: true }));
  return app;
}

describe("parseExtraOrigins", () => {
  it("returns nothing when unset", () => {
    expect(parseExtraOrigins(undefined)).toEqual([]);
  });

  it("splits, trims, and drops trailing slashes", () => {
    expect(parseExtraOrigins("https://a.test/, https://b.test ")).toEqual([
      "https://a.test",
      "https://b.test",
    ]);
  });

  it("ignores empty segments from a trailing comma", () => {
    expect(parseExtraOrigins("https://a.test,,")).toEqual(["https://a.test"]);
  });
});

describe("isAllowedOrigin", () => {
  it("allows the iOS webview origin", () => {
    expect(isAllowedOrigin("capacitor://localhost", [])).toBe(true);
  });

  it("allows the Android webview origin", () => {
    expect(isAllowedOrigin("http://localhost", [])).toBe(true);
  });

  it("rejects a missing origin", () => {
    expect(isAllowedOrigin(undefined, [])).toBe(false);
  });

  it("rejects an arbitrary site", () => {
    expect(isAllowedOrigin("https://evil.test", [])).toBe(false);
  });

  it("does not match on prefix — a lookalike host is not the allowlisted one", () => {
    expect(isAllowedOrigin("capacitor://localhost.evil.test", [])).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.test", [])).toBe(false);
  });

  it("allows explicitly configured extra origins", () => {
    expect(isAllowedOrigin("https://staging.test", ["https://staging.test"])).toBe(true);
  });
});

describe("corsMiddleware", () => {
  it("stamps allowed responses with the exact origin, never a wildcard", async () => {
    const res = await appWith().request("/api/health", {
      headers: { origin: "capacitor://localhost" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("never grants credentials", async () => {
    const res = await appWith().request("/api/health", {
      headers: { origin: "capacitor://localhost" },
    });
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("omits CORS headers for a disallowed origin", async () => {
    const res = await appWith().request("/api/health", {
      headers: { origin: "https://evil.test" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("leaves same-origin web requests untouched", async () => {
    const res = await appWith().request("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an allowed preflight with 204 and the permitted verbs", async () => {
    const res = await appWith().request("/api/events", {
      method: "OPTIONS",
      headers: { origin: "capacitor://localhost" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("stamps a streaming SSE response — live research is the one call that must not fail", async () => {
    const app = new Hono();
    app.use("/api/*", corsMiddleware([]));
    app.get("/api/research/session/x/events", () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    const res = await app.request("/api/research/session/x/events", {
      headers: { origin: "capacitor://localhost" },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    expect(await res.text()).toContain("data: hi");
  });

  it("refuses a preflight from an unknown origin", async () => {
    const res = await appWith().request("/api/events", {
      method: "OPTIONS",
      headers: { origin: "https://evil.test" },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
