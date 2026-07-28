import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CategoryIdSchema,
  QueryTypeSchema,
  ReportSchema,
  type Assumption,
  type Location,
  type PlanQuestion,
  type Report,
  type ResearchControl,
  type ResearchError,
  type ResearchEvent,
  type ResearchMode,
  type SeedAssumption,
  type StageTiming,
} from "../../shared/report";
import { PLAYBOOKS, questionsForMode, type Playbook } from "../../shared/playbooks";
import { loadEnv } from "../env";
import { callGemini, extractJson, GeminiError } from "../gemini";
import {
  affirmedAssumptionTexts,
  applyControls,
  deriveHoursSaved,
  shouldStopDeepEvidence,
} from "./controls";
import { PROMPTS, promptVersions } from "./prompts";
import { harvestImages, type ImageTask } from "./images";
import { assembleReport, parsePrice, SanitizeError } from "./sanitize";
import { domainFromChunk, usableChunks, type RawChunk } from "./sources";
import { getReport, saveReport, saveServerEvent } from "../db";
import { lookupFresh, remember } from "./cache";

/**
 * Multi-step research workflow per docs/ENGINE.md:
 * classify (ungrounded JSON, fast model) -> plan (no model call) -> evidence
 * (grounded, sequential; quick=1 batch, full<=3, deep<=5 with a sufficiency
 * heuristic) -> synthesize (ungrounded JSON over accumulated evidence) ->
 * sanitize + assemble (pure, validated). Pending mid-run controls (drained via
 * `drainControls`) are applied at stage boundaries and between evidence
 * batches; completed evidence is never discarded.
 * Emits ResearchEvent progress and records telemetry via the db seam.
 */

const FALLBACK_ANON_ID = "server-side-00";
const EVIDENCE_BATCH_LIMITS: Record<ResearchMode, number> = { quick: 1, full: 3, deep: 5 };

export type EmitFn = (event: ResearchEvent) => void;
export type DrainControlsFn = () => ResearchControl[];

export type ResearchInput = {
  readonly query: string;
  readonly mode: ResearchMode;
  readonly sessionId?: string;
  readonly deviceId?: string;
  /** Coarse buyer location (resolved in the route from geo header or user input). */
  readonly location?: Location | null;
  readonly emit?: EmitFn;
  /** Live-session id; defaults to the report id for non-session runs. */
  readonly researchId?: string;
  /** Returns (and clears) any user controls queued since the last drain. */
  readonly drainControls?: DrainControlsFn;
  /**
   * User-edited assumptions carried from a prior report (M3). When present and
   * non-empty, these REPLACE the classifier's inferred assumptions (origin
   * "user") so a "re-run with my changes" starts pre-adjusted. Seeded by text.
   */
  readonly seedAssumptions?: readonly SeedAssumption[];
  /**
   * Skip the category cache entirely (read AND write). The eval harness sets
   * this so it always measures fresh engine output — a cached report must never
   * mask an engine regression, or the eval gate (M5) would be meaningless.
   */
  readonly noCache?: boolean;
};

export class PipelineError extends Error {
  constructor(
    readonly code: ResearchError["code"],
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

const ClassifySchema = z.object({
  queryType: QueryTypeSchema.catch("need"),
  category: z
    .object({
      id: CategoryIdSchema.catch("other"),
      label: z.string().catch(""),
      confidence: z.number().min(0).max(1).catch(0.6),
    })
    .catch({ id: "other", label: "", confidence: 0.6 }),
  assumptions: z.array(z.string().catch("")).catch([]),
  extraQuestions: z
    .array(
      z.union([
        z.object({
          text: z.string(),
          whyItMatters: z.union([z.string(), z.null()]).catch(null),
        }),
        z.null(),
      ]).catch(null),
    )
    .catch([])
    .transform((list) => list.filter((q): q is { text: string; whyItMatters: string | null } => q !== null)),
});
type ClassifyOutput = z.infer<typeof ClassifySchema>;

const nullableNumber = z.union([z.number(), z.null()]).catch(null);
const CandidateSchema = z.object({
  name: z.string().min(1),
  priceMin: nullableNumber,
  priceMax: nullableNumber,
  /** Average rating out of 5 when a source stated one — carried to synthesis. */
  rating: nullableNumber,
  notes: z.union([z.string(), z.null()]).catch(null),
  reviewThemes: z.array(z.string()).catch([]),
  retailerMentions: z
    .array(z.object({ seller: z.string(), url: z.union([z.string(), z.null()]).catch(null) }))
    .catch([]),
});
type Candidate = z.infer<typeof CandidateSchema>;
const EvidenceSchema = z.object({
  candidates: z
    .array(z.union([CandidateSchema, z.null()]).catch(null))
    .catch([])
    .transform((list) => list.filter((c): c is Candidate => c !== null)),
  findings: z
    .array(z.object({ questionId: z.string().catch(""), summary: z.string().catch("") }))
    .catch([]),
  disagreements: z
    .array(z.string().catch(""))
    .catch([])
    .transform((list) => list.filter((s) => s.trim() !== "")),
});
type EvidenceOutput = z.infer<typeof EvidenceSchema>;

type AnonIds = { readonly sessionId: string; readonly deviceId: string };
type Ctx = { stage: string; retried: boolean; reportId: string | null };

const anonIds = (input: ResearchInput): AnonIds => ({
  sessionId: input.sessionId ?? FALLBACK_ANON_ID,
  deviceId: input.deviceId ?? FALLBACK_ANON_ID,
});

function recordServerEvent(ids: AnonIds, body: Record<string, unknown>): void {
  try {
    saveServerEvent({
      eventId: nanoid(16),
      sessionId: ids.sessionId,
      deviceId: ids.deviceId,
      ts: new Date().toISOString(),
      ...body,
    });
  } catch (err) {
    console.error("[pipeline] failed to record server event", err);
  }
}

function toPipelineError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof GeminiError) {
    if (err.code === "rate-limited") {
      return new PipelineError("rate-limited", "The research engine is rate-limited right now. Try again in a moment.", true);
    }
    return new PipelineError("research-failed", "Live research failed before completing. Nothing was fabricated — please retry.", true);
  }
  if (err instanceof SanitizeError) {
    return new PipelineError("research-failed", "The research result failed validation. Please retry.", true);
  }
  return new PipelineError("research-failed", "Live research failed unexpectedly. Please retry.", true);
}

function buildPlan(
  playbook: Playbook,
  mode: ResearchMode,
  extras: readonly { text: string; whyItMatters: string | null }[],
): PlanQuestion[] {
  const fromPlaybook = questionsForMode(playbook, mode).map(
    (q): PlanQuestion => ({
      id: q.id,
      text: q.template,
      status: "pending",
      whyItMatters: q.whyItMatters,
      origin: "playbook",
      sourceCount: 0,
    }),
  );
  const fromEngine = extras.slice(0, 2).flatMap((q, i): PlanQuestion[] => {
    const text = q.text.trim();
    if (text === "") return [];
    return [
      {
        id: `engine-${i + 1}`,
        text,
        status: "pending",
        whyItMatters: q.whyItMatters?.trim() === "" ? null : q.whyItMatters,
        origin: "engine",
        sourceCount: 0,
      },
    ];
  });
  return [...fromPlaybook, ...fromEngine];
}

/** Contiguous, evenly sized groups; question order is leverage order. */
function chunkEvenly<T>(items: readonly T[], maxGroups: number): T[][] {
  if (items.length === 0) return [];
  const n = Math.min(maxGroups, items.length);
  const size = Math.ceil(items.length / n);
  return Array.from({ length: n }, (_, i) => items.slice(i * size, (i + 1) * size)).filter(
    (g) => g.length > 0,
  );
}

const setStatus = (
  questions: readonly PlanQuestion[],
  ids: ReadonlySet<string>,
  status: PlanQuestion["status"],
  sourceCount?: number,
): PlanQuestion[] =>
  questions.map((q) =>
    ids.has(q.id) ? { ...q, status, sourceCount: sourceCount ?? q.sourceCount } : q,
  );

function maybeEmitBestFit(evidence: EvidenceOutput, emit: EmitFn): void {
  const top = evidence.candidates[0];
  if (top === undefined || top.name.trim() === "") return; // never fabricate a leader
  const hasPrice = top.priceMin !== null || top.priceMax !== null;
  const backups = evidence.candidates
    .slice(1, 3)
    .filter((c) => c.name.trim() !== "")
    .map((c) => ({ name: c.name.trim(), note: c.notes ?? c.reviewThemes[0] ?? null }));
  emit({
    type: "best-fit-so-far",
    name: top.name.trim(),
    priceDisplay: hasPrice ? parsePrice({ min: top.priceMin, max: top.priceMax }).display : null,
    note: top.notes ?? top.reviewThemes[0] ?? null,
    ...(backups.length > 0 ? { backups } : {}),
  });
}

/** Live source refs for the stream — same title/url rules as buildSources. */
function chunksToSourceItems(
  chunks: readonly RawChunk[],
): { title: string; url: string; domain: string }[] {
  return chunks.map((ch) => {
    const domain = domainFromChunk(ch);
    return {
      title: ch.title.trim() === "" ? domain : ch.title.trim(),
      url: ch.uri,
      domain,
    };
  });
}

/**
 * Resolves the assumption set for a run. User-seeded assumptions from a "re-run
 * with my changes" (M3) REPLACE the classifier's inferences (origin "user", up
 * to 8, seeded by text); otherwise the classifier's inferred set is used (up to
 * 5). `affirmed: false` seeds a dismissed, non-steering assumption. Pure.
 */
export function resolveAssumptions(
  seedAssumptions: readonly SeedAssumption[] | undefined,
  classifyAssumptions: readonly string[],
): Assumption[] {
  const seeds = (seedAssumptions ?? [])
    .map((s) => ({ text: s.text.trim(), affirmed: s.affirmed }))
    .filter((s) => s.text !== "")
    .slice(0, 8);
  if (seeds.length > 0) {
    return seeds.map((s, i) => ({
      id: `a${i + 1}`,
      text: s.text,
      origin: "user" as const,
      affirmed: s.affirmed,
    }));
  }
  return classifyAssumptions
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, 5)
    .map((text, i) => ({ id: `a${i + 1}`, text, origin: "inferred" as const, affirmed: true }));
}

export async function runResearch(input: ResearchInput): Promise<Report> {
  const t0 = Date.now();
  const emit: EmitFn = input.emit ?? (() => undefined);
  const ctx: Ctx = { stage: "init", retried: false, reportId: null };
  try {
    return await execute(input, emit, ctx, t0);
  } catch (err) {
    const perr = toPipelineError(err);
    console.error(`[pipeline] research failed stage=${ctx.stage} code=${perr.code}`);
    recordServerEvent(anonIds(input), {
      name: "report_failed",
      reportId: ctx.reportId,
      stage: ctx.stage,
      code: perr.code,
      totalMs: Date.now() - t0,
      retried: ctx.retried,
    });
    emit({
      type: "error",
      error: { ok: false, code: perr.code, message: perr.message, retryable: perr.retryable },
    });
    throw perr;
  }
}

async function execute(input: ResearchInput, emit: EmitFn, ctx: Ctx, t0: number): Promise<Report> {
  const env = loadEnv();
  if (env.geminiApiKey === null) {
    throw new PipelineError("engine-not-configured", "The research engine is not configured on this server.", false);
  }
  const apiKey = env.geminiApiKey;
  const model = env.geminiModel;
  const query = input.query.trim();
  // Coarse location scopes local-retailer research; "default"-source labels are
  // treated as unknown so we never invent local stores (M3 gate 2).
  const location: Location | null = input.location ?? null;
  const locationLabel = location?.label;
  const locationKnown = location !== null && location.source !== "default";

  // Category cache (M5 gate 3): an identical recent query in a cacheable mode
  // reuses its prior report instead of spending Gemini again. HONEST — the
  // report is returned UNCHANGED, carrying its real createdAt (which the UI
  // shows); it is never relabelled as fetched "now". Freshness is per-category
  // (short for price-sensitive electronics); quick mode is never cached. See
  // engine/cache.ts. We emit the terminal "report" event so the live/session
  // flow completes exactly as a fresh run would (session.ts treats it terminal).
  // Personalized runs (user-edited assumption seeds) never read or write the
  // shared cache — they answer one user's situation, not the shared query. The
  // cache is location-scoped so one place's local retailers never serve another.
  const personalized = (input.seedAssumptions?.length ?? 0) > 0;
  const cacheScope = locationKnown ? locationLabel : undefined;
  const cacheHit =
    input.noCache || personalized ? null : lookupFresh(query, input.mode, Date.now(), cacheScope);
  if (cacheHit !== null) {
    const cached = getReport(cacheHit.reportId);
    if (cached !== null) {
      ctx.reportId = cached.id;
      console.error(
        `[pipeline] category cache hit (mode=${input.mode}); reusing report ${cached.id} researched ${cached.createdAt} — skipping Gemini`,
      );
      emit({ type: "report", report: cached });
      return cached;
    }
  }

  const reportId = nanoid(12);
  ctx.reportId = reportId;
  const ids = anonIds(input);
  const timings: StageTiming[] = [];
  const elapsed = (): number => Date.now() - t0;

  const runStage = async <T>(
    name: string,
    fn: () => Promise<{ value: T; retries: number }>,
    detail?: string,
  ): Promise<T> => {
    ctx.stage = name;
    emit({ type: "stage", stage: name, status: "started", elapsedMs: elapsed(), ...(detail === undefined ? {} : { detail }) });
    const s0 = Date.now();
    try {
      const { value, retries } = await fn();
      const ms = Date.now() - s0;
      if (retries > 0) ctx.retried = true;
      timings.push({ stage: name, ms, retries });
      emit({ type: "stage", stage: name, status: "completed", elapsedMs: elapsed() });
      recordServerEvent(ids, { name: "research_stage_completed", reportId, stage: name, ms, retries });
      return value;
    } catch (err) {
      emit({ type: "stage", stage: name, status: "failed", elapsedMs: elapsed() });
      throw err;
    }
  };

  // 1. Classify (one ungrounded JSON call on the fast model; one fallback to
  // the main model on any fast-model error — S1 latency target).
  const classify: ClassifyOutput = await runStage("classify", async () => {
    const classifyOnce = async (m: string) =>
      callGemini(
        { apiKey, model: m, prompt: PROMPTS.classify.build({ query }), grounded: false },
        (text) => ClassifySchema.parse(extractJson(text)),
      );
    try {
      const res = await classifyOnce(env.geminiFastModel);
      return { value: res.data, retries: res.retries };
    } catch (err) {
      if (env.geminiFastModel === model) throw err;
      console.error(
        "[pipeline] fast-model classify failed; falling back to main model",
        err instanceof Error ? err.message : err,
      );
      const res = await classifyOnce(model);
      return { value: res.data, retries: res.retries + 1 };
    }
  });

  let assumptions: Assumption[] = resolveAssumptions(input.seedAssumptions, classify.assumptions);
  emit({ type: "assumptions", assumptions });

  // 2. Plan (playbook questions + engine extras; no model call).
  const playbook = PLAYBOOKS[classify.category.id];
  const categoryLabel = classify.category.label.trim() === "" ? playbook.label : classify.category.label.trim();
  let plan: PlanQuestion[] = await runStage("plan", async () => ({
    value: buildPlan(playbook, input.mode, classify.extraQuestions),
    retries: 0,
  }));
  emit({ type: "plan", questions: plan });

  // Curated playbook questions the mode trim left out — one-tap additions for
  // the user, never invented filler (no model call).
  const plannedIds = new Set(plan.map((q) => q.id));
  const suggestions = [...playbook.questions]
    .sort((a, b) => b.leverage - a.leverage)
    .filter((q) => !plannedIds.has(q.id))
    .slice(0, 3)
    .map((q) => ({ id: q.id, text: q.template, whyItMatters: q.whyItMatters }));
  if (suggestions.length > 0) emit({ type: "suggested-questions", suggestions });

  // Mid-run controls: drained and applied at stage boundaries and between
  // evidence batches. Completed evidence is never discarded (docs/ENGINE.md).
  const drain: DrainControlsFn = input.drainControls ?? (() => []);
  const researchId = input.researchId ?? reportId;
  let remaining: PlanQuestion[][] = [];
  const applyPendingControls = (): void => {
    const controls = drain();
    if (controls.length === 0) return;
    const outcome = applyControls({ plan, assumptions, remaining }, controls);
    plan = [...outcome.state.plan];
    assumptions = [...outcome.state.assumptions];
    remaining = outcome.state.remaining.map((g) => [...g]);
    if (outcome.assumptionsChanged) emit({ type: "assumptions", assumptions });
    if (outcome.planChanged) emit({ type: "plan", questions: plan });
    for (const a of outcome.applied) {
      emit({ type: "control-applied", controlId: a.controlId, detail: a.detail });
    }
    if (outcome.applied.length > 0) {
      recordServerEvent(ids, {
        name: "research_redirected",
        researchId,
        stage: ctx.stage,
        controlsApplied: outcome.applied.length,
      });
    }
  };

  // 3. Evidence (grounded, sequential; quick=1 batch, full<=3, deep<=5 with
  // an early-stop sufficiency heuristic).
  remaining = chunkEvenly(plan, EVIDENCE_BATCH_LIMITS[input.mode]);
  const evidenceOutputs: EvidenceOutput[] = [];
  let allChunks: RawChunk[] = [];
  let evidenceFailures = 0;
  let batchIndex = 0;

  const runEvidenceBatch = async (group: PlanQuestion[]): Promise<void> => {
    batchIndex += 1;
    const stageName = `evidence-${batchIndex}`;
    const groupIds = new Set(group.map((q) => q.id));
    plan = setStatus(plan, groupIds, "active");
    emit({ type: "plan", questions: plan });
    try {
      const result = await runStage(
        stageName,
        async () => {
          // Step 1 — grounded FREE TEXT so the search tool actually runs
          // (JSON-demand prompts make newer models skip search and answer from
          // memory — fabricated "evidence"; see prompts.ts evidence v2.0.0).
          const research = await callGemini(
            {
              apiKey,
              model,
              grounded: true,
              prompt: PROMPTS.evidence.build({
                query,
                categoryLabel,
                criteria: playbook.criteria,
                assumptions: affirmedAssumptionTexts(assumptions),
                questions: group.map((q) => ({ id: q.id, text: q.text })),
                ...(locationLabel === undefined ? {} : { location: locationLabel }),
                locationKnown,
                concise: input.mode === "quick",
              }),
            },
            (text) => text,
          );
          // Step 2 — ungrounded structuring; the notes are the only source.
          // Fast model first, main model as fallback (same policy as classify).
          const structurePrompt = PROMPTS.evidenceStructure.build({
            notes: research.data,
            questionIds: group.map((q) => q.id),
          });
          const structureOnce = async (m: string) =>
            callGemini(
              { apiKey, model: m, grounded: false, prompt: structurePrompt },
              (text) => EvidenceSchema.parse(extractJson(text)),
            );
          let structured;
          try {
            structured = await structureOnce(env.geminiFastModel);
          } catch (err) {
            if (env.geminiFastModel === model) throw err;
            console.error(
              "[pipeline] fast-model evidence structuring failed; falling back to main model",
              err instanceof Error ? err.message : err,
            );
            structured = await structureOnce(model);
          }
          return {
            value: { data: structured.data, sources: research.sources },
            retries: research.retries + structured.retries,
          };
        },
        `${group.length} question${group.length === 1 ? "" : "s"}`,
      );
      const before = usableChunks(allChunks).length;
      allChunks = [...allChunks, ...result.sources];
      const usable = usableChunks(allChunks);
      const total = usable.length;
      const newUniqueSources = Math.max(0, total - before);
      plan = setStatus(plan, groupIds, "done", newUniqueSources);
      emit({ type: "plan", questions: plan });
      emit({ type: "sources", count: total, items: chunksToSourceItems(usable) });
      evidenceOutputs.push(result.data);
      maybeEmitBestFit(result.data, emit);
      // Deep-mode sufficiency: after batch 3, a thin batch ends the loop.
      if (
        input.mode === "deep" &&
        remaining.length > 0 &&
        shouldStopDeepEvidence(evidenceOutputs.length, newUniqueSources)
      ) {
        console.error(
          `[pipeline] deep evidence judged sufficient after ${evidenceOutputs.length} batches (+${newUniqueSources} new sources); skipping ${remaining.length} remaining batch(es)`,
        );
        remaining = [];
      }
    } catch (err) {
      // One failed evidence group is survivable; S5 caps confidence honestly.
      evidenceFailures += 1;
      plan = setStatus(plan, groupIds, "pending");
      emit({ type: "plan", questions: plan });
      console.error(`[pipeline] evidence batch ${batchIndex} failed`, err instanceof Error ? err.message : err);
    }
  };

  while (remaining.length > 0) {
    applyPendingControls();
    const group = remaining[0];
    remaining = remaining.slice(1);
    if (group === undefined || group.length === 0) continue;
    await runEvidenceBatch(group);
  }

  // Final boundary: controls that arrived after the last batch. User-added
  // questions that missed the evidence loop get ONE extra small grounded batch.
  ctx.stage = "evidence-boundary";
  applyPendingControls();
  const leftoverUserQuestions = remaining
    .flat()
    .filter((q) => q.status === "pending" && q.origin === "user");
  remaining = [];
  if (leftoverUserQuestions.length > 0) {
    await runEvidenceBatch(leftoverUserQuestions);
  }

  if (evidenceOutputs.length === 0) {
    ctx.stage = "evidence";
    throw new PipelineError("research-failed", "Evidence gathering failed. Nothing was fabricated — please retry.", true);
  }
  if (evidenceFailures > 0) ctx.retried = true;

  // Honest time-saved estimate from real observables only.
  const answeredQuestions = plan.filter((q) => q.status === "done").length;
  const hoursSaved = deriveHoursSaved(answeredQuestions, usableChunks(allChunks).length);
  if (hoursSaved !== null) emit({ type: "time-saved", estimate: hoursSaved });

  // 4. Synthesize (one ungrounded JSON call over evidence + source list).
  const chunks = usableChunks(allChunks);
  const sourceList =
    chunks.length === 0
      ? "(no sources were captured)"
      : chunks
          .map((ch, i) => `s${i + 1} — ${ch.title.trim() === "" ? domainFromChunk(ch) : ch.title.trim()} (${domainFromChunk(ch)})`)
          .join("\n");
  const evidenceNotes = evidenceOutputs
    .map((e, i) => `Evidence batch ${i + 1}: ${JSON.stringify(e)}`)
    .join("\n");
  const synthesis = await runStage("synthesize", async () => {
    const res = await callGemini(
      {
        apiKey,
        model,
        grounded: false,
        // Synthesis over full-mode evidence produces large JSON; the default
        // ungrounded timeout (25s) sits below observed generation time (~23s
        // quick, more for full) and caused hard failures at this stage.
        timeoutMs: 90_000,
        prompt: PROMPTS.synthesize.build({
          query,
          queryType: classify.queryType,
          categoryLabel,
          criteria: playbook.criteria,
          assumptions: affirmedAssumptionTexts(assumptions),
          evidenceNotes,
          sourceList,
          ...(locationLabel === undefined ? {} : { location: locationLabel }),
          locationKnown,
          concise: input.mode === "quick",
        }),
      },
      (text) => {
        const json = extractJson(text);
        if (typeof json !== "object" || json === null || Array.isArray(json)) {
          throw new GeminiError("parse", "Synthesis output was not a JSON object", true);
        }
        return json;
      },
    );
    return { value: res.data, retries: res.retries };
  });

  // 5. Sanitize + assemble (pure, server-side, schema-validated).
  ctx.stage = "sanitize";
  const report = assembleReport({
    reportId,
    query,
    createdAt: new Date().toISOString(),
    queryType: classify.queryType,
    category: { id: classify.category.id, label: categoryLabel, confidence: classify.category.confidence },
    assumptions,
    questions: plan,
    location,
    synthesis,
    rawSources: chunks,
    hoursSaved,
    meta: {
      model,
      mode: input.mode,
      stageTimings: timings,
      totalMs: elapsed(),
      promptVersions: promptVersions(),
      playbookId: playbook.id,
      playbookVersion: playbook.version,
      evidenceDisagreements: evidenceOutputs.flatMap((e) => e.disagreements),
    },
  });

  // 5b. Real product imagery — og:image from pages this research actually
  // cited. Sources first, then retailer listings: the big retailers answer a
  // server fetch with 403, and the search URLs we link shoppers to are results
  // grids with no product image, so leading with them spent the whole budget
  // on refusals. Hard budget; a miss stays null. Never stock, never generated.
  ctx.stage = "product-images";
  const sourceUrlById = new Map(report.sources.map((s) => [s.id, s.url]));
  const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const citedRetailerUrls = (name: string): string[] => {
    const n = normName(name);
    return evidenceOutputs
      .flatMap((e) => e.candidates)
      .filter((c) => {
        const cn = normName(c.name);
        return cn !== "" && n !== "" && (cn.includes(n) || n.includes(cn));
      })
      .flatMap((c) => c.retailerMentions)
      .map((r) => r.url)
      .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
  };
  // Every cited page is a fallback candidate for every pick: the title gate in
  // harvestImage refuses any page that doesn't name that product, so breadth
  // costs nothing in correctness and is what gets alternatives a picture.
  const allSourceUrls = report.sources.map((s) => s.url);
  const sourceUrlsFor = (ids: readonly string[]): string[] =>
    ids.map((id) => sourceUrlById.get(id)).filter((u): u is string => u !== undefined);
  const imageTasks: ImageTask[] = [
    {
      key: "bestFit",
      name: report.bestFit.name,
      urls: [
        ...sourceUrlsFor(report.bestFit.sourceIds),
        ...citedRetailerUrls(report.bestFit.name),
        ...report.retailers.map((r) => r.url).filter((u): u is string => u !== null),
        ...allSourceUrls,
      ],
    },
    ...report.alternatives.slice(0, 4).map((alt) => ({
      key: `alt-${alt.rank}`,
      name: alt.name,
      urls: [...citedRetailerUrls(alt.name), ...allSourceUrls],
    })),
  ].filter((task) => task.urls.length > 0);
  let finalReport = report;
  if (imageTasks.length > 0) {
    emit({ type: "stage", stage: "product-images", status: "started", elapsedMs: elapsed(), detail: "from cited pages" });
    // Attempts now run concurrently, so wall clock is roughly one fetch
    // timeout rather than the sum — 5s leaves room for parse without letting a
    // slow page hold up a report that is otherwise finished.
    const images = await harvestImages(imageTasks, 5000);
    const withImages = {
      ...report,
      bestFit: { ...report.bestFit, imageUrl: images["bestFit"] ?? null },
      alternatives: report.alternatives.map((alt) => ({
        ...alt,
        imageUrl: images[`alt-${alt.rank}`] ?? null,
      })),
    };
    // A harvested URL must never break the validated contract — on any
    // mismatch the report ships without images rather than failing.
    const revalidated = ReportSchema.safeParse(withImages);
    finalReport = revalidated.success ? revalidated.data : report;
    emit({ type: "stage", stage: "product-images", status: "completed", elapsedMs: elapsed() });
  }
  const report2 = finalReport;

  emit({ type: "report", report: report2 });
  try {
    saveReport(report2);
  } catch (err) {
    // The user still gets their report; persistence failure is logged loudly.
    console.error("[pipeline] saveReport failed", err);
  }
  // Remember this report so an identical future query reuses it while fresh
  // (no-op for quick mode, or when the caller opted out of the cache). A cache
  // write must never break the response.
  if (!input.noCache && !personalized) {
    try {
      remember(query, input.mode, report2, cacheScope);
    } catch (err) {
      console.error("[pipeline] cache remember failed", err);
    }
  }
  recordServerEvent(ids, {
    name: "report_completed",
    reportId: report2.id,
    queryType: report2.queryType,
    category: report2.category.id,
    mode: report2.meta.mode,
    confidence: report2.verdict.confidence,
    sourceCount: report2.sources.length,
    sourceClassCount: report2.meta.sourceDiversity.classesRepresented.length,
    disagreementCount: report2.meta.disagreements.length,
    totalMs: report2.meta.totalMs,
    playbookVersion: report2.meta.playbookVersion,
  });
  return report2;
}
