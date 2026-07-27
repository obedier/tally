import type { Context, Hono } from "hono";
import {
  CommentRequestSchema,
  CreatePollRequestSchema,
  VoteRequestSchema,
} from "../../shared/poll";
import { getReport } from "../db";
import { addComment, castVote, createPoll, getPoll } from "../db/polls";
import { createRateLimiter } from "../rateLimit";

/**
 * Decision-poll API (M4 growth). Polls are server-persisted and account-free.
 * Error responses mirror the stable envelope used by routes/reports.ts —
 * `{ ok: false, code, message }` — and never leak stack traces.
 */

type ErrorCode = "invalid" | "not-found" | "bad-option" | "server-error" | "rate-limited";

interface ErrorEnvelope {
  ok: false;
  code: ErrorCode;
  message: string;
}

function error(code: ErrorCode, message: string): ErrorEnvelope {
  return { ok: false, code, message };
}

/**
 * Soft anti-abuse bound on poll writes (votes/comments/creates), keyed by
 * client IP. Anonymous polls can't be perfectly fraud-proofed (IP rotation
 * exists), but this stops trivial scripted ballot-stuffing/comment-flooding so
 * a public poll's displayed counts aren't meaningless. Votes stay one-per-device
 * regardless (UNIQUE(poll_id, device_id) in the DB).
 */
const pollWriteLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxPerKey: 40,
  maxGlobal: 600,
});

const clientIp = (c: Context): string => c.req.header("x-forwarded-for") ?? "unknown";

const RATE_LIMITED = error(
  "rate-limited",
  "Too many poll actions in a short time. Please wait a moment and try again.",
);

export function registerPollRoutes(app: Hono): void {
  // POST /api/polls — create a poll from a report's shortlist.
  app.post("/api/polls", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(error("invalid", "The request body could not be read."), 400);
    }
    if (pollWriteLimiter(clientIp(c), Date.now())) return c.json(RATE_LIMITED, 429);
    const parsed = CreatePollRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(error("invalid", "This poll request wasn't valid."), 400);
    }
    // The poll's evidence must trace to a real report — no orphan polls.
    if (!getReport(parsed.data.reportId)) {
      return c.json(error("not-found", "That research report no longer exists."), 404);
    }
    try {
      const poll = createPoll(parsed.data);
      return c.json({ poll }, 201);
    } catch {
      return c.json(error("server-error", "The poll couldn't be created."), 500);
    }
  });

  // GET /api/polls/:id — a full poll with tallies and comments.
  app.get("/api/polls/:id", (c) => {
    const poll = getPoll(c.req.param("id"));
    if (!poll) {
      return c.json(error("not-found", "This poll isn't here."), 404);
    }
    return c.json({ poll });
  });

  // POST /api/polls/:id/vote — one vote per device (a re-vote moves the vote).
  app.post("/api/polls/:id/vote", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(error("invalid", "The request body could not be read."), 400);
    }
    if (pollWriteLimiter(clientIp(c), Date.now())) return c.json(RATE_LIMITED, 429);
    const parsed = VoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(error("invalid", "This vote wasn't valid."), 400);
    }
    const result = castVote(c.req.param("id"), parsed.data.optionId, parsed.data.deviceId);
    if (result === "not-found") {
      return c.json(error("not-found", "This poll isn't here."), 404);
    }
    if (result === "bad-option") {
      return c.json(error("bad-option", "That isn't one of this poll's options."), 400);
    }
    return c.json({ poll: result });
  });

  // POST /api/polls/:id/comment — an account-free comment.
  app.post("/api/polls/:id/comment", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(error("invalid", "The request body could not be read."), 400);
    }
    if (pollWriteLimiter(clientIp(c), Date.now())) return c.json(RATE_LIMITED, 429);
    const parsed = CommentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(error("invalid", "This comment wasn't valid."), 400);
    }
    const result = addComment(c.req.param("id"), parsed.data.text, parsed.data.deviceId);
    if (result === "not-found") {
      return c.json(error("not-found", "This poll isn't here."), 404);
    }
    return c.json({ poll: result });
  });
}
