import type { Hono } from "hono";
import { CreatePriceWatchRequestSchema } from "../../shared/priceWatch";
import { getReport } from "../db";
import { createWatch, listWatches } from "../db/priceWatch";
import { createRateLimiter } from "../rateLimit";

/**
 * Price-watch API (M4 growth). Honest framing per docs/GROWTH.md: a watch is a
 * saved re-check, not a promised alert — the server only RECORDS it. Stable JSON
 * error envelopes ({ ok, code, message }) mirror routes/reports.ts; no stack
 * traces leak to the client.
 */

// Soft anti-spam bound on watch writes, keyed by client IP (creates are
// idempotent per device+report+rank, so this only stops scripted flooding).
const watchLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, maxPerKey: 40, maxGlobal: 600 });

export function registerPriceWatchRoutes(app: Hono): void {
  app.post("/api/price-watch", async (c) => {
    if (watchLimiter(c.req.header("x-forwarded-for") ?? "unknown", Date.now())) {
      return c.json(
        { ok: false, code: "rate-limited", message: "Too many requests. Please wait a moment." },
        429,
      );
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { ok: false, code: "invalid-request", message: "Body must be valid JSON." },
        400,
      );
    }

    const parsed = CreatePriceWatchRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { ok: false, code: "invalid-request", message: "Invalid price-watch request." },
        400,
      );
    }

    // A watch must point at a report that actually exists — no orphan watches.
    if (!getReport(parsed.data.reportId)) {
      return c.json({ ok: false, code: "not-found", message: "Report not found." }, 404);
    }

    try {
      const watch = createWatch(parsed.data);
      return c.json({ ok: true, watch });
    } catch {
      return c.json(
        { ok: false, code: "server-error", message: "The watch could not be saved." },
        500,
      );
    }
  });

  app.get("/api/price-watch", (c) => {
    const deviceId = c.req.query("deviceId");
    if (!deviceId) {
      return c.json(
        { ok: false, code: "invalid-request", message: "deviceId is required." },
        400,
      );
    }
    return c.json({ ok: true, watches: listWatches(deviceId) });
  });
}
