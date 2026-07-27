import { z } from "zod";

/**
 * The stable report contract. The frontend renders ONLY this shape; the server
 * validates and sanitizes every model output into it before it leaves the API.
 * Raw model text never crosses the seam.
 */

export const QUERY_TYPES = ["named-product", "need", "problem", "sku"] as const;
export const QueryTypeSchema = z.enum(QUERY_TYPES);
export type QueryType = z.infer<typeof QueryTypeSchema>;

export const CATEGORY_IDS = ["consumer-electronics", "home-goods", "other"] as const;
export const CategoryIdSchema = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof CategoryIdSchema>;

export const RESEARCH_MODES = ["quick", "full", "deep"] as const;
export const ResearchModeSchema = z.enum(RESEARCH_MODES);
export type ResearchMode = z.infer<typeof ResearchModeSchema>;

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** Evidence provenance classes, per docs/ENGINE.md. */
export const SOURCE_CLASSES = [
  "manufacturer",
  "retailer",
  "editorial",
  "owner-review",
  "other",
] as const;
export const SourceClassSchema = z.enum(SOURCE_CLASSES);
export type SourceClass = z.infer<typeof SourceClassSchema>;

export const SourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  /** Display domain (e.g. "rtings.com") resolved from the grounding redirect where possible. */
  domain: z.string().min(1),
  sourceClass: SourceClassSchema,
});
export type Source = z.infer<typeof SourceSchema>;

export const PriceRangeSchema = z.object({
  /** Numeric bounds in `currency` units; null when evidence is too weak — never invented. */
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().default("USD"),
  /** Human display string, e.g. "$400–$730" or "Check retailer". */
  display: z.string().min(1),
});
export type PriceRange = z.infer<typeof PriceRangeSchema>;

export const RatingSummarySchema = z.object({
  /** e.g. 4.5; null when unverifiable. */
  value: z.number().min(0).max(5).nullable(),
  outOf: z.literal(5).default(5),
  /** One-paragraph digest of review themes. Never invented counts. */
  summary: z.string().min(1),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;

export const ProductPickSchema = z.object({
  name: z.string().min(1),
  priceRange: PriceRangeSchema,
  rating: RatingSummarySchema.nullable(),
  pros: z.array(z.string().min(1)).min(1).max(8),
  cons: z.array(z.string().min(1)).min(1).max(8),
  /** Why this is the best fit for THIS user's assumptions — concise, repeatable. */
  whyBest: z.string().min(1),
  /** Source ids backing the key claims about this pick. */
  sourceIds: z.array(z.string()).default([]),
});
export type ProductPick = z.infer<typeof ProductPickSchema>;

export const AlternativeSchema = z.object({
  rank: z.number().int().min(2),
  name: z.string().min(1),
  priceRange: PriceRangeSchema.nullable(),
  ratingValue: z.number().min(0).max(5).nullable(),
  /** The tradeoff in one sentence — what different priority makes this the pick instead. */
  note: z.string().min(1),
  /**
   * Per-competitor evidence for the comparison grid (M3). Defaulted empty so
   * pre-M3 stored reports keep validating; never fabricated — the sanitizer
   * leaves these empty when the evidence didn't support them.
   */
  pros: z.array(z.string().min(1)).max(4).default([]),
  cons: z.array(z.string().min(1)).max(4).default([]),
  /** One-line digest of review themes; null when no verified reviews exist. */
  reviewSummary: z.string().min(1).nullable().default(null),
  /** Marks the single "excellent alternative for different priorities" per docs/PRODUCT.md. */
  isKeyAlternative: z.boolean().default(false),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const RETAILER_KINDS = ["online", "local", "online-local"] as const;
export const RetailerListingSchema = z.object({
  seller: z.string().min(1),
  kind: z.enum(RETAILER_KINDS),
  price: PriceRangeSchema,
  availability: z.string().min(1),
  /** Direct retailer URL when the evidence provided one; never fabricated. */
  url: z.string().url().nullable(),
  /** For local rows: the coarse place the listing applies to (e.g. "Seattle, WA"); null for online-only. */
  locality: z.string().min(1).nullable().default(null),
});
export type RetailerListing = z.infer<typeof RetailerListingSchema>;

/**
 * Coarse buyer location used to scope local retailers (M3). Never precise —
 * region/city granularity only, per docs/LEARNING.md privacy rules. `source`
 * records how it was set so the UI can be honest ("detected" vs "you set").
 */
export const LocationSchema = z.object({
  label: z.string().min(1),
  source: z.enum(["ip", "user", "default"]),
});
export type Location = z.infer<typeof LocationSchema>;

export const AssumptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  origin: z.enum(["inferred", "user"]),
  affirmed: z.boolean(),
});
export type Assumption = z.infer<typeof AssumptionSchema>;

/**
 * User-edited assumptions carried from a completed report into a fresh research
 * run (M3 "change assumptions from results"). Seeded by TEXT — the new session
 * assigns fresh ids — so re-inference id drift can't misalign them. `affirmed:
 * false` seeds a dismissed assumption (visible, non-steering), matching M2.
 */
export const SeedAssumptionSchema = z.object({
  text: z.string().min(1).max(200),
  affirmed: z.boolean(),
});
export type SeedAssumption = z.infer<typeof SeedAssumptionSchema>;

export const PlanQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["done", "active", "pending", "removed"]),
  whyItMatters: z.string().nullable(),
  origin: z.enum(["playbook", "engine", "user"]),
  sourceCount: z.number().int().nonnegative().default(0),
});
export type PlanQuestion = z.infer<typeof PlanQuestionSchema>;

export const VerdictSchema = z.object({
  /** The one-liner a user can repeat verbatim to a friend. */
  headline: z.string().min(1),
  rationale: z.string().min(1),
  confidence: ConfidenceSchema,
  /**
   * Honest explanation of the confidence level. When source diversity is weak
   * (fewer than 3 classes), this MUST say so — enforced by the sanitizer.
   */
  confidenceReason: z.string().min(1),
  /** The one or two factors most likely to change the user's decision. */
  decisiveFactors: z.array(z.string().min(1)).min(1).max(3),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const StageTimingSchema = z.object({
  stage: z.string().min(1),
  ms: z.number().nonnegative(),
  retries: z.number().int().nonnegative().default(0),
});
export type StageTiming = z.infer<typeof StageTimingSchema>;

export const ReportMetaSchema = z.object({
  engineVersion: z.string().min(1),
  playbookId: z.string().min(1),
  playbookVersion: z.string().min(1),
  /** Prompt version per stage, e.g. { classify: "v1", synthesize: "v1" }. */
  promptVersions: z.record(z.string()),
  model: z.string().min(1),
  mode: ResearchModeSchema,
  stageTimings: z.array(StageTimingSchema),
  totalMs: z.number().nonnegative(),
  /** Cross-source disagreements the engine detected (empty when none). */
  disagreements: z.array(z.string()),
  sourceDiversity: z.object({
    count: z.number().int().nonnegative(),
    classesRepresented: z.array(SourceClassSchema),
  }),
});
export type ReportMeta = z.infer<typeof ReportMetaSchema>;

/**
 * Honest research-effort estimate: derived from questions answered and sources
 * consulted, always presented as an estimate — never a fabricated metric.
 */
export const HoursSavedSchema = z.object({
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  basis: z.string().min(1),
});
export type HoursSaved = z.infer<typeof HoursSavedSchema>;

export const ReportSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  /** Nullable so pre-M2 stored reports keep validating. */
  hoursSaved: HoursSavedSchema.nullable().default(null),
  queryType: QueryTypeSchema,
  category: z.object({
    id: CategoryIdSchema,
    label: z.string().min(1),
    confidence: z.number().min(0).max(1),
  }),
  createdAt: z.string().datetime(),
  assumptions: z.array(AssumptionSchema),
  questions: z.array(PlanQuestionSchema),
  verdict: VerdictSchema,
  bestFit: ProductPickSchema,
  /** Ranked; for a "need" query this is the shortlist below the #1 pick. */
  alternatives: z.array(AlternativeSchema).max(10),
  retailers: z.array(RetailerListingSchema).max(12),
  /** Coarse location used to scope local retailers; null for pre-M3 reports or when unknown. */
  location: LocationSchema.nullable().default(null),
  sources: z.array(SourceSchema),
  meta: ReportMetaSchema,
});
export type Report = z.infer<typeof ReportSchema>;

/** Shape of GET /api/reports list rows. */
export const ReportListItemSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  createdAt: z.string(),
  verdictHeadline: z.string(),
  category: z.string(),
});
export type ReportListItem = z.infer<typeof ReportListItemSchema>;

/** API envelope for completed research. */
export const ResearchResponseSchema = z.object({
  ok: z.literal(true),
  report: ReportSchema,
});
export const ResearchErrorSchema = z.object({
  ok: z.literal(false),
  /** Stable machine code; never raw upstream error bodies. */
  code: z.enum([
    "invalid-request",
    "engine-not-configured",
    "research-failed",
    "rate-limited",
    "not-found",
  ]),
  /** Safe, user-facing message. */
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ResearchError = z.infer<typeof ResearchErrorSchema>;

/**
 * SSE progress events streamed while research runs. M1 emits stage + report;
 * M2 builds the live experience (best-fit-so-far, plan updates) on the same bus.
 */
export const ResearchEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.string().min(1),
    status: z.enum(["started", "completed", "failed"]),
    detail: z.string().optional(),
    elapsedMs: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("assumptions"),
    assumptions: z.array(AssumptionSchema),
  }),
  z.object({
    type: z.literal("plan"),
    questions: z.array(PlanQuestionSchema),
  }),
  z.object({
    type: z.literal("sources"),
    count: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("best-fit-so-far"),
    name: z.string().min(1),
    priceDisplay: z.string().nullable(),
    note: z.string().nullable(),
  }),
  z.object({
    type: z.literal("time-saved"),
    estimate: HoursSavedSchema,
  }),
  z.object({
    /** Acknowledges an applied mid-run control change so the UI can confirm honestly. */
    type: z.literal("control-applied"),
    controlId: z.string().min(1),
    detail: z.string().min(1),
  }),
  z.object({
    type: z.literal("report"),
    report: ReportSchema,
  }),
  z.object({
    type: z.literal("error"),
    error: ResearchErrorSchema,
  }),
]);
export type ResearchEvent = z.infer<typeof ResearchEventSchema>;

/**
 * Mid-run control messages for a live research session. Applied between
 * evidence batches: completed work is never discarded, removed questions are
 * never spent on, added questions and edited assumptions steer remaining work.
 */
export const ResearchControlSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("remove-question"),
    controlId: z.string().min(1),
    questionId: z.string().min(1),
  }),
  z.object({
    type: z.literal("add-question"),
    controlId: z.string().min(1),
    text: z.string().min(3).max(300),
  }),
  z.object({
    type: z.literal("set-assumption"),
    controlId: z.string().min(1),
    assumptionId: z.string().min(1),
    affirmed: z.boolean(),
    /** Optional replacement text when the user edits the wording. */
    text: z.string().min(3).max(300).optional(),
  }),
  z.object({
    type: z.literal("add-assumption"),
    controlId: z.string().min(1),
    text: z.string().min(3).max(300),
  }),
]);
export type ResearchControl = z.infer<typeof ResearchControlSchema>;

export const StartSessionResponseSchema = z.object({
  ok: z.literal(true),
  researchId: z.string().min(1),
});
