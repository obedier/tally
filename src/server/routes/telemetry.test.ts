import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// Set the DB path BEFORE any db function runs (the connection opens lazily).
process.env.TALLY_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "tally-telemetry-test-")),
  "test.db",
);

import { Hono } from "hono";
import { registerTelemetryRoutes } from "./telemetry";

function makeApp(): Hono {
  const app = new Hono();
  registerTelemetryRoutes(app);
  return app;
}

function validEvent(eventId: string): object {
  return {
    eventId,
    sessionId: "sess_abc123XYZ",
    deviceId: "dev_abc123XYZ",
    ts: "2026-07-27T12:00:00.000Z",
    name: "report_viewed",
    reportId: "r1",
    surface: "summary",
  };
}

async function postEvents(app: Hono, body: string): Promise<Response> {
  return app.request("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("POST /api/events", () => {
  test("accepts a valid batch and reports counts", async () => {
    const app = makeApp();
    const res = await postEvents(
      app,
      JSON.stringify({ events: [validEvent("evt_route_1"), validEvent("evt_route_2")] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 2, rejected: 0 });
  });

  test("counts invalid events as rejected without failing the batch", async () => {
    const app = makeApp();
    const res = await postEvents(
      app,
      JSON.stringify({ events: [validEvent("evt_route_3"), { name: "report_viewed" }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, rejected: 1 });
  });

  test("returns 400 on non-JSON body", async () => {
    const res = await postEvents(makeApp(), "not json at all");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; code: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid-request");
  });

  test("returns 400 on a malformed envelope (events missing)", async () => {
    const res = await postEvents(makeApp(), JSON.stringify({ nope: [] }));
    expect(res.status).toBe(400);
  });

  test("returns 400 on an empty events array", async () => {
    const res = await postEvents(makeApp(), JSON.stringify({ events: [] }));
    expect(res.status).toBe(400);
  });

  test("returns 400 on a batch larger than 50 events", async () => {
    const events = Array.from({ length: 51 }, (_, i) => validEvent(`evt_big_${i}`));
    const res = await postEvents(makeApp(), JSON.stringify({ events }));
    expect(res.status).toBe(400);
  });

  test("rejects bodies over 100KB with 413", async () => {
    const padding = "x".repeat(101 * 1024);
    const res = await postEvents(makeApp(), JSON.stringify({ events: [padding] }));
    expect(res.status).toBe(413);
  });
});

describe("GET /api/events/counts", () => {
  test("reflects accepted events", async () => {
    const app = makeApp();
    await postEvents(app, JSON.stringify({ events: [validEvent("evt_counts_1")] }));
    const res = await app.request("/api/events/counts");
    expect(res.status).toBe(200);
    const counts = (await res.json()) as { name: string; count: number }[];
    const viewed = counts.find((row) => row.name === "report_viewed");
    expect(viewed).toBeDefined();
    expect(viewed?.count).toBeGreaterThanOrEqual(1);
  });
});
