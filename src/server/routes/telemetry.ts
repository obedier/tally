import type { Hono } from "hono";
import { TelemetryBatchSchema } from "../../shared/telemetry";
import { getEventCounts, saveClientEvents } from "../db";

/** Telemetry ingestion + audit surface, per docs/LEARNING.md. */

const MAX_BODY_BYTES = 100 * 1024;

export function registerTelemetryRoutes(app: Hono): void {
  app.post("/api/events", async (c) => {
    let raw: string;
    try {
      raw = await c.req.text();
    } catch {
      return c.json(
        { ok: false, code: "invalid-request", message: "Unreadable request body." },
        400,
      );
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return c.json(
        { ok: false, code: "payload-too-large", message: "Event batch exceeds 100KB." },
        413,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json(
        { ok: false, code: "invalid-request", message: "Body must be valid JSON." },
        400,
      );
    }
    const batch = TelemetryBatchSchema.safeParse(body);
    if (!batch.success) {
      return c.json(
        {
          ok: false,
          code: "invalid-request",
          message: "Body must be { events: [...] } with 1-50 entries.",
        },
        400,
      );
    }
    return c.json(saveClientEvents(batch.data.events));
  });

  /** Dev/audit surface for verifying "events actually arrived". */
  app.get("/api/events/counts", (c) => c.json(getEventCounts()));
}
