import { z } from "zod";
import { AnonIdSchema } from "./telemetry";

/**
 * Price watch (M4 growth): set from a report to track a pick's price. Honest
 * framing per docs/GROWTH.md — "real information, on the user's terms". NEVER
 * fabricated urgency/scarcity/countdowns (a non-negotiable). Server-persisted.
 * Notification DELIVERY is out of V1 scope (no email/push infra) — the watch is
 * recorded and honestly framed as a saved re-check, not a promised alert.
 */

export const PriceWatchSchema = z.object({
  id: z.string().min(1),
  reportId: z.string().min(1),
  /** Ranked pick watched (1 = best fit). */
  rank: z.number().int().positive(),
  pickName: z.string().min(1).max(200),
  createdAt: z.string(),
});
export type PriceWatch = z.infer<typeof PriceWatchSchema>;

/** POST /api/price-watch — record a watch (idempotent per device+report+rank). */
export const CreatePriceWatchRequestSchema = z.object({
  reportId: z.string().min(1),
  rank: z.number().int().positive(),
  pickName: z.string().min(1).max(200),
  deviceId: AnonIdSchema,
});
export type CreatePriceWatchRequest = z.infer<typeof CreatePriceWatchRequestSchema>;
