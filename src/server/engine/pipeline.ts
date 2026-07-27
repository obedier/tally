import { nanoid } from "nanoid";
import { z } from "zod";
import {
  CategoryIdSchema,
  QueryTypeSchema,
  type Assumption,
  type PlanQuestion,
  type Report,
  type ResearchError,
  type ResearchEvent,
  type ResearchMode,
  type StageTiming,
} from "../../shared/report";
import { PLAYBOOKS, questionsForMode, type Playbook } from "../../shared/playbooks";
import { loadEnv } from "../env";
import { callGemini, extractJson, GeminiError } from "../gemini";
import { PROMPTS, promptVersions } from "./prompts";
import { assembleReport, parsePrice, SanitizeError } from "./sanitize";
import { domainFromChunk, usableChunks, type RawChunk } from "./sources";
import { saveReport, saveServerEvent } from "../db";

/**
 * Multi-step research workflow per docs/ENGINE.md:
 * classify (ungrounded JSON) -> plan (no model call) -> evidence (grounded,
 * 1 call quick / up to 3 full+deep, sequential) -> synthesize (ungrounded
 * JSON over accumulated evidence) -> sanitize + assemble (pure, validated).
 * Emits ResearchEvent progress and records telemetry via the db seam.
 */

const FALLBACK_ANON_ID = "server-side-00";
const EVIDENCE_CALLS: Record<ResearchMode, number> = { quick: 1, full: 3, deep: 3 };

export type EmitFn = (event: ResearchEvent) => void;

export type ResearchInput = {
  readonly query: string;
  readonly mode: ResearchMode;
  readonly sessionId?: string;
  readonly deviceId?: string;
  readonly emit?: EmitFn;
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
  emit({
    type: "best-fit-so-far",
    name: top.name.trim(),
    priceDisplay: hasPrice ? parsePrice({ min: top.priceMin, max: top.priceMax }).display : null,
    note: top.notes ?? top.reviewThemes[0] ?? null,
  });
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

  // 1. Classify (one ungrounded JSON call).
  const classify: ClassifyOutput = await runStage("classify", async () => {
    const res = await callGemini(
      { apiKey, model, prompt: PROMPTS.classify.build({ query }), grounded: false },
      (text) => ClassifySchema.parse(extractJson(text)),
    );
    return { value: res.data, retries: res.retries };
  });

  const assumptions: Assumption[] = classify.assumptions
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, 5)
    .map((text, i) => ({ id: `a${i + 1}`, text, origin: "inferred" as const, affirmed: true }));
  emit({ type: "assumptions", assumptions });

  // 2. Plan (playbook questions + engine extras; no model call).
  const playbook = PLAYBOOKS[classify.category.id];
  const categoryLabel = classify.category.label.trim() === "" ? playbook.label : classify.category.label.trim();
  let plan: PlanQuestion[] = await runStage("plan", async () => ({
    value: buildPlan(playbook, input.mode, classify.extraQuestions),
    retries: 0,
  }));
  emit({ type: "plan", questions: plan });

  // 3. Evidence (grounded, sequential; quick=1 call, full/deep<=3).
  const groups = chunkEvenly(plan, EVIDENCE_CALLS[input.mode]);
  const assumptionTexts = assumptions.map((a) => a.text);
  const evidenceOutputs: EvidenceOutput[] = [];
  let allChunks: RawChunk[] = [];
  let evidenceFailures = 0;

  for (const [i, group] of groups.entries()) {
    const stageName = `evidence-${i + 1}`;
    const groupIds = new Set(group.map((q) => q.id));
    plan = setStatus(plan, groupIds, "active");
    emit({ type: "plan", questions: plan });
    try {
      const result = await runStage(
        stageName,
        async () => {
          const res = await callGemini(
            {
              apiKey,
              model,
              grounded: true,
              prompt: PROMPTS.evidence.build({
                query,
                categoryLabel,
                criteria: playbook.criteria,
                assumptions: assumptionTexts,
                questions: group.map((q) => ({ id: q.id, text: q.text })),
              }),
            },
            (text) => EvidenceSchema.parse(extractJson(text)),
          );
          return { value: res, retries: res.retries };
        },
        `${group.length} question${group.length === 1 ? "" : "s"}`,
      );
      const before = usableChunks(allChunks).length;
      allChunks = [...allChunks, ...result.sources];
      const total = usableChunks(allChunks).length;
      plan = setStatus(plan, groupIds, "done", Math.max(0, total - before));
      emit({ type: "plan", questions: plan });
      emit({ type: "sources", count: total });
      evidenceOutputs.push(result.data);
      if (evidenceOutputs.length === 1) maybeEmitBestFit(result.data, emit);
    } catch (err) {
      // One failed evidence group is survivable; S5 caps confidence honestly.
      evidenceFailures += 1;
      plan = setStatus(plan, groupIds, "pending");
      emit({ type: "plan", questions: plan });
      console.error(`[pipeline] evidence group ${i + 1} failed`, err instanceof Error ? err.message : err);
    }
  }
  if (evidenceOutputs.length === 0) {
    ctx.stage = "evidence";
    throw new PipelineError("research-failed", "Evidence gathering failed. Nothing was fabricated — please retry.", true);
  }
  if (evidenceFailures > 0) ctx.retried = true;

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
          assumptions: assumptionTexts,
          evidenceNotes,
          sourceList,
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
    synthesis,
    rawSources: chunks,
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

  emit({ type: "report", report });
  try {
    saveReport(report);
  } catch (err) {
    // The user still gets their report; persistence failure is logged loudly.
    console.error("[pipeline] saveReport failed", err);
  }
  recordServerEvent(ids, {
    name: "report_completed",
    reportId: report.id,
    queryType: report.queryType,
    category: report.category.id,
    mode: report.meta.mode,
    confidence: report.verdict.confidence,
    sourceCount: report.sources.length,
    sourceClassCount: report.meta.sourceDiversity.classesRepresented.length,
    disagreementCount: report.meta.disagreements.length,
    totalMs: report.meta.totalMs,
    playbookVersion: report.meta.playbookVersion,
  });
  return report;
}
