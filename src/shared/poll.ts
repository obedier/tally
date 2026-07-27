import { z } from "zod";
import { AnonIdSchema } from "./telemetry";

/**
 * Decision polls (M4 growth): created from a report's shortlist, voted and
 * commented on WITHOUT an account (keyed to an anonymous deviceId, one vote per
 * device), with the research evidence visible to voters. Server-persisted —
 * never faked client-side (CLAUDE.md engineering rule).
 */

export const PollOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(120),
  /** Ranked pick this option came from (1 = best fit) — ties the option to report evidence. */
  rank: z.number().int().positive(),
  /** One-line "why this" carried from the report; null when none. */
  note: z.string().min(1).max(280).nullable().default(null),
});
export type PollOption = z.infer<typeof PollOptionSchema>;

export const PollCommentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(500),
  createdAt: z.string(),
});
export type PollComment = z.infer<typeof PollCommentSchema>;

export const PollSchema = z.object({
  id: z.string().min(1),
  reportId: z.string().min(1),
  question: z.string().min(1).max(200),
  createdAt: z.string(),
  options: z.array(PollOptionSchema).min(2).max(10),
  /** Vote counts keyed by optionId. */
  tallies: z.record(z.number().int().nonnegative()),
  totalVotes: z.number().int().nonnegative(),
  comments: z.array(PollCommentSchema),
});
export type Poll = z.infer<typeof PollSchema>;

/** POST /api/polls — create from a report shortlist. */
export const CreatePollRequestSchema = z.object({
  reportId: z.string().min(1),
  question: z.string().min(1).max(200),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        rank: z.number().int().positive(),
        note: z.string().min(1).max(280).nullable().default(null),
      }),
    )
    .min(2)
    .max(10),
  deviceId: AnonIdSchema,
});
export type CreatePollRequest = z.infer<typeof CreatePollRequestSchema>;

/** POST /api/polls/:id/vote — one vote per device (re-vote moves the vote). */
export const VoteRequestSchema = z.object({
  optionId: z.string().min(1),
  deviceId: AnonIdSchema,
});
export type VoteRequest = z.infer<typeof VoteRequestSchema>;

/** POST /api/polls/:id/comment — account-free comment. */
export const CommentRequestSchema = z.object({
  text: z.string().min(1).max(500),
  deviceId: AnonIdSchema,
});
export type CommentRequest = z.infer<typeof CommentRequestSchema>;
