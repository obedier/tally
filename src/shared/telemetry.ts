import { z } from "zod";
import { CategoryIdSchema, ConfidenceSchema, QueryTypeSchema, ResearchModeSchema } from "./report";

/**
 * Telemetry event contract, per docs/LEARNING.md.
 * Privacy rules (non-negotiable): anonymous session/device ids only; never
 * names, emails, or precise location. Events are validated server-side against
 * this schema; invalid events are rejected and counted, never stored raw.
 */

/** Anonymous ids: generated client-side, opaque, never derived from identity. */
export const AnonIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,32}$/);

export const EventEnvelopeSchema = z.object({
  eventId: z.string().min(8),
  sessionId: AnonIdSchema,
  deviceId: AnonIdSchema,
  /** Client timestamp, ISO 8601. Server stamps receivedAt separately. */
  ts: z.string().datetime(),
});

const searchStarted = z.object({
  name: z.literal("search_started"),
  query: z.string().min(1).max(500),
  mode: ResearchModeSchema,
  entry: z.enum(["home-search", "example-chip", "history", "rerun"]),
});

const researchStageCompleted = z.object({
  name: z.literal("research_stage_completed"),
  reportId: z.string().min(1),
  stage: z.string().min(1),
  ms: z.number().nonnegative(),
  retries: z.number().int().nonnegative(),
});

const reportCompleted = z.object({
  name: z.literal("report_completed"),
  reportId: z.string().min(1),
  queryType: QueryTypeSchema,
  category: CategoryIdSchema,
  mode: ResearchModeSchema,
  confidence: ConfidenceSchema,
  sourceCount: z.number().int().nonnegative(),
  sourceClassCount: z.number().int().nonnegative(),
  disagreementCount: z.number().int().nonnegative(),
  totalMs: z.number().nonnegative(),
  playbookVersion: z.string().min(1),
});

const reportFailed = z.object({
  name: z.literal("report_failed"),
  reportId: z.string().nullable(),
  stage: z.string().min(1),
  code: z.string().min(1),
  totalMs: z.number().nonnegative(),
  retried: z.boolean(),
});

const reportViewed = z.object({
  name: z.literal("report_viewed"),
  reportId: z.string().min(1),
  surface: z.enum(["summary", "detail", "prices", "research"]),
});

const sourceClicked = z.object({
  name: z.literal("source_clicked"),
  reportId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceClass: z.string().min(1),
});

/** Outbound retailer clicks — decision-confidence signal #1 per docs/PRODUCT.md. */
const retailerClicked = z.object({
  name: z.literal("retailer_clicked"),
  reportId: z.string().min(1),
  seller: z.string().min(1),
  kind: z.enum(["online", "local", "online-local"]),
});

export const EventBodySchema = z.discriminatedUnion("name", [
  searchStarted,
  researchStageCompleted,
  reportCompleted,
  reportFailed,
  reportViewed,
  sourceClicked,
  retailerClicked,
]);
export type EventBody = z.infer<typeof EventBodySchema>;

export const TelemetryEventSchema = EventEnvelopeSchema.and(EventBodySchema);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type TelemetryEventName = EventBody["name"];

export const TelemetryBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(50),
});
