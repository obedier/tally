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
  entry: z.enum(["home-search", "example-chip", "history", "rerun", "share-cta", "poll"]),
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
  surface: z.enum(["summary", "detail", "prices", "research", "share"]),
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

/** M2 live-research events: user steering + abandonment are direct playbook signal. */
const assumptionEdited = z.object({
  name: z.literal("assumption_edited"),
  researchId: z.string().min(1),
  action: z.enum(["affirmed", "dismissed", "reworded", "added"]),
});

const questionEdited = z.object({
  name: z.literal("question_edited"),
  researchId: z.string().min(1),
  action: z.enum(["added", "removed"]),
  /** Playbook question id when a playbook question was removed; null for user-added. */
  questionId: z.string().nullable(),
});

const researchRedirected = z.object({
  name: z.literal("research_redirected"),
  researchId: z.string().min(1),
  stage: z.string().min(1),
  controlsApplied: z.number().int().positive(),
});

const researchAbandoned = z.object({
  name: z.literal("research_abandoned"),
  researchId: z.string().min(1),
  stage: z.string().min(1),
  elapsedMs: z.number().nonnegative(),
});

/** A live-stream source link opened mid-research (domain only — never a query). */
const researchSourceClicked = z.object({
  name: z.literal("research_source_clicked"),
  researchId: z.string().min(1),
  domain: z.string().min(1),
});

const deepDiveStarted = z.object({
  name: z.literal("deep_dive_started"),
  fromReportId: z.string().min(1),
});

/** M3 results-engagement: an explicit save of a pick (best fit or an alternative). */
const pickSaved = z.object({
  name: z.literal("pick_saved"),
  reportId: z.string().min(1),
  pickKind: z.enum(["best-fit", "alternative"]),
  /** Ranked position saved (1 = best fit); no product identity beyond rank is logged. */
  rank: z.number().int().positive(),
});

/** M3 results-engagement: the comparison grid was opened/used. */
const comparisonUsed = z.object({
  name: z.literal("comparison_used"),
  reportId: z.string().min(1),
  alternativesShown: z.number().int().nonnegative(),
});

/* ---- M4 growth-loop events (docs/GROWTH.md instrumentation) ---- */

/** A share link was created/copied from a report. */
const shareCreated = z.object({
  name: z.literal("share_created"),
  reportId: z.string().min(1),
  surface: z.enum(["report", "compare", "prices"]),
});

/** A public share page was viewed (the visitor side of the loop). */
const sharePageViewed = z.object({
  name: z.literal("share_page_viewed"),
  reportId: z.string().min(1),
  /** True when the viewer has no prior Tally session on this device. */
  firstTouch: z.boolean(),
});

/** Visitor→searcher: the share-page CTA to run your own research was clicked. */
const ctaClicked = z.object({
  name: z.literal("cta_clicked"),
  reportId: z.string().min(1),
  cta: z.enum(["research-your-own", "re-run"]),
});

/** A decision poll was created from a report shortlist. */
const pollCreated = z.object({
  name: z.literal("poll_created"),
  pollId: z.string().min(1),
  reportId: z.string().min(1),
  optionCount: z.number().int().positive(),
});

/** An account-free vote was cast on a poll. */
const pollVoted = z.object({
  name: z.literal("poll_voted"),
  pollId: z.string().min(1),
});

/** An account-free comment was left on a poll. */
const pollCommented = z.object({
  name: z.literal("poll_commented"),
  pollId: z.string().min(1),
});

/** A price watch was set from a report (honest framing; no notification promise). */
const priceWatchSet = z.object({
  name: z.literal("price_watch_set"),
  reportId: z.string().min(1),
  /** Ranked pick watched (1 = best fit); no product identity is logged. */
  rank: z.number().int().positive(),
});

/** Thumbs up/down on a report — direct quality signal for query mining (M5). */
const reportFeedback = z.object({
  name: z.literal("report_feedback"),
  reportId: z.string().min(1),
  rating: z.enum(["up", "down"]),
});

export const EventBodySchema = z.discriminatedUnion("name", [
  searchStarted,
  researchStageCompleted,
  reportCompleted,
  reportFailed,
  reportViewed,
  sourceClicked,
  retailerClicked,
  assumptionEdited,
  questionEdited,
  researchRedirected,
  researchAbandoned,
  researchSourceClicked,
  deepDiveStarted,
  pickSaved,
  comparisonUsed,
  shareCreated,
  sharePageViewed,
  ctaClicked,
  pollCreated,
  pollVoted,
  pollCommented,
  priceWatchSet,
  reportFeedback,
]);
export type EventBody = z.infer<typeof EventBodySchema>;

export const TelemetryEventSchema = EventEnvelopeSchema.and(EventBodySchema);
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type TelemetryEventName = EventBody["name"];

export const TelemetryBatchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(50),
});
