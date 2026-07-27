import type { Hono } from "hono";
import { stream } from "hono/streaming";
import {
  ResearchControlSchema,
  ResearchModeSchema,
  type ResearchError,
  type ResearchEvent,
  type ResearchMode,
} from "../../shared/report";
import { AnonIdSchema } from "../../shared/telemetry";
import { PipelineError, runResearch } from "../engine/pipeline";
import {
  getSessionStatus,
  queueControl,
  startResearchSession,
  subscribeToSession,
} from "../engine/session";

/**
 * Research API routes.
 * Live sessions (M2):
 * - POST /api/research/session — start a steerable session; returns researchId.
 * - GET /api/research/session/:id/events — SSE; replays ALL logged events
 *   first (lossless reconnect), then live events; heartbeats; closes after the
 *   terminal report/error event.
 * - POST /api/research/session/:id/control — queue a mid-run ResearchControl.
 * Legacy (behavior unchanged):
 * - GET /api/research/stream — SSE; each ResearchEvent as `data: <json>\n\n`,
 *   heartbeat comment every 15s, closes after the report or error event.
 * - POST /api/research — same pipeline without streaming (used by evals).
 * Errors are always the stable ResearchError codes — never upstream bodies
 * or stack traces. Details go to console.error (no key material).
 */

const HEARTBEAT_MS = 15_000;
const MAX_QUERY_LENGTH = 500;

/**
 * Inbound rate limiting: research spends real money per call, so cap starts
 * per client (IP + anon session when present). Sliding window, in-memory —
 * adequate for the single-process V1 server.
 */
// 12 per 10 min bounds abuse while leaving headroom for the sequential
// golden-query eval suite (~110s per case on one session id).
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_STARTS = 12;
const rateBuckets = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const kept = (rateBuckets.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (kept.length >= RATE_MAX_STARTS) {
    rateBuckets.set(key, kept);
    return true;
  }
  rateBuckets.set(key, [...kept, now]);
  if (rateBuckets.size > 10_000) rateBuckets.clear();
  return false;
}

const RATE_LIMIT_ERROR: ResearchError = {
  ok: false,
  code: "rate-limited",
  message: "Too many research runs in a short time. Please wait a few minutes and retry.",
  retryable: true,
};

function clientKey(ip: string | undefined, sessionId: string | undefined): string {
  return `${ip ?? "unknown"}:${sessionId ?? "anon"}`;
}

type ValidatedParams = {
  readonly query: string;
  readonly mode: ResearchMode;
  readonly sessionId?: string;
  readonly deviceId?: string;
};

type Validation =
  | { readonly ok: true; readonly value: ValidatedParams }
  | { readonly ok: false; readonly error: ResearchError };

const invalid = (message: string): Validation => ({
  ok: false,
  error: { ok: false, code: "invalid-request", message, retryable: false },
});

function validateParams(
  rawQuery: unknown,
  rawMode: unknown,
  rawSessionId: unknown,
  rawDeviceId: unknown,
): Validation {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (query.length < 1 || query.length > MAX_QUERY_LENGTH) {
    return invalid(`Query must be between 1 and ${MAX_QUERY_LENGTH} characters.`);
  }
  const mode = ResearchModeSchema.safeParse(rawMode);
  if (!mode.success) {
    return invalid("Mode must be one of: quick, full, deep.");
  }
  const sessionId = AnonIdSchema.safeParse(rawSessionId);
  const deviceId = AnonIdSchema.safeParse(rawDeviceId);
  return {
    ok: true,
    value: {
      query,
      mode: mode.data,
      ...(sessionId.success ? { sessionId: sessionId.data } : {}),
      ...(deviceId.success ? { deviceId: deviceId.data } : {}),
    },
  };
}

function toResearchError(err: unknown): ResearchError {
  if (err instanceof PipelineError) {
    return { ok: false, code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    ok: false,
    code: "research-failed",
    message: "Live research failed unexpectedly. Please retry.",
    retryable: true,
  };
}

const STATUS_BY_CODE: Record<ResearchError["code"], 400 | 404 | 429 | 502 | 503> = {
  "invalid-request": 400,
  "engine-not-configured": 503,
  "rate-limited": 429,
  "research-failed": 502,
  "not-found": 404,
};

const NOT_FOUND_ERROR: ResearchError = {
  ok: false,
  code: "not-found",
  message: "No live research session with that id. It may have expired.",
  retryable: false,
};

export function registerResearchRoutes(app: Hono): void {
  app.post("/api/research/session", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const error = invalid("Request body must be JSON with { query, mode }.");
      return c.json(error.ok === false ? error.error : null, 400);
    }
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const parsed = validateParams(record.query, record.mode, record.sessionId, record.deviceId);
    if (!parsed.ok) return c.json(parsed.error, 400);
    const ip = c.req.header("x-forwarded-for");
    if (rateLimited(clientKey(ip, parsed.value.sessionId))) {
      return c.json(RATE_LIMIT_ERROR, 429);
    }
    const researchId = startResearchSession(parsed.value);
    return c.json({ ok: true as const, researchId }, 200);
  });

  app.get("/api/research/session/:id/events", (c) => {
    const id = c.req.param("id");
    if (getSessionStatus(id) === null) return c.json(NOT_FOUND_ERROR, 404);

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return stream(c, async (s) => {
      // Serialize writes: listeners are synchronous, stream writes are async.
      let chain: Promise<void> = Promise.resolve();
      const push = (payload: string): void => {
        chain = chain
          .then(async () => {
            await s.write(payload);
          })
          .catch(() => undefined);
      };
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const send = (event: ResearchEvent): void => {
        push(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "report" || event.type === "error") resolveDone();
      };
      // Atomic snapshot + live registration: every event exactly once, in order.
      const sub = subscribeToSession(id, send);
      if (sub === null) {
        // Session GC'd between the check and here (practically impossible —
        // both are synchronous); close with a stable error event.
        push(`data: ${JSON.stringify({ type: "error", error: NOT_FOUND_ERROR })}\n\n`);
        await chain;
        return;
      }
      const heartbeat = setInterval(() => push(":hb\n\n"), HEARTBEAT_MS);
      s.onAbort(() => {
        clearInterval(heartbeat);
        sub.unsubscribe();
        resolveDone();
      });
      for (const event of sub.replay) send(event);
      await done;
      clearInterval(heartbeat);
      sub.unsubscribe();
      await chain;
    });
  });

  app.post("/api/research/session/:id/control", async (c) => {
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const error = invalid("Request body must be a JSON ResearchControl.");
      return c.json(error.ok === false ? error.error : null, 400);
    }
    const parsed = ResearchControlSchema.safeParse(body);
    if (!parsed.success) {
      const error = invalid("Control failed validation. See the ResearchControl contract.");
      return c.json(error.ok === false ? error.error : null, 400);
    }
    const result = queueControl(id, parsed.data);
    if (result === "not-found") return c.json(NOT_FOUND_ERROR, 404);
    if (result === "terminal") {
      const error: ResearchError = {
        ok: false,
        code: "invalid-request",
        message: "Research already completed.",
        retryable: false,
      };
      return c.json(error, 409);
    }
    return c.json({ ok: true as const }, 200);
  });

  app.get("/api/research/stream", (c) => {
    const parsed = validateParams(
      c.req.query("query"),
      c.req.query("mode"),
      c.req.query("sessionId"),
      c.req.query("deviceId"),
    );
    if (!parsed.ok) return c.json(parsed.error, 400);
    const ip = c.req.header("x-forwarded-for");
    if (rateLimited(clientKey(ip, parsed.value.sessionId))) {
      return c.json(RATE_LIMIT_ERROR, 429);
    }

    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("X-Accel-Buffering", "no");

    return stream(c, async (s) => {
      // Serialize writes: emit is synchronous, stream writes are async.
      let chain: Promise<void> = Promise.resolve();
      const push = (payload: string): void => {
        chain = chain
          .then(async () => {
            await s.write(payload);
          })
          .catch(() => undefined);
      };
      const emit = (event: ResearchEvent): void => {
        push(`data: ${JSON.stringify(event)}\n\n`);
      };
      const heartbeat = setInterval(() => push(":hb\n\n"), HEARTBEAT_MS);
      s.onAbort(() => clearInterval(heartbeat));
      try {
        // The pipeline emits the terminal report/error event itself.
        await runResearch({ ...parsed.value, emit });
      } catch (err) {
        // Error event already emitted by the pipeline; log the stable code only.
        const rerr = toResearchError(err);
        console.error(`[research/stream] failed code=${rerr.code}`);
      } finally {
        clearInterval(heartbeat);
        await chain;
      }
    });
  });

  app.post("/api/research", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const error = invalid("Request body must be JSON with { query, mode }.");
      return c.json(error.ok === false ? error.error : null, 400);
    }
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const parsed = validateParams(record.query, record.mode, record.sessionId, record.deviceId);
    if (!parsed.ok) return c.json(parsed.error, 400);
    const ip = c.req.header("x-forwarded-for");
    if (rateLimited(clientKey(ip, parsed.value.sessionId))) {
      return c.json(RATE_LIMIT_ERROR, 429);
    }

    try {
      const report = await runResearch(parsed.value);
      return c.json({ ok: true as const, report }, 200);
    } catch (err) {
      const rerr = toResearchError(err);
      console.error(`[research] failed code=${rerr.code}`);
      return c.json(rerr, STATUS_BY_CODE[rerr.code]);
    }
  });
}
