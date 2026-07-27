import {
  CATEGORY_IDS,
  QUERY_TYPES,
  RESEARCH_MODES,
  type CategoryId,
  type QueryType,
  type ResearchMode,
} from "../../shared/report";
import { PLAYBOOKS } from "../../shared/playbooks";
import { getDb } from "../db";

/**
 * Query mining (M5, per docs/LEARNING.md "Mining real queries").
 *
 * Reads the server-side `telemetry_events` + `reports` tables and proposes, for
 * human review, three things:
 *   1. Playbook-question ADD candidates — questions users frequently add
 *      themselves (a playbook gap).
 *   2. Playbook-question DEMOTE candidates — playbook questions users frequently
 *      remove.
 *   3. New EVAL-CASE candidates — low-confidence and thumbs-down reports become
 *      golden cases so their weaknesses become permanent regression checks.
 *
 * Nothing here mutates the playbook or the eval suite; it emits reviewable
 * suggestions only. Output is aggregate/anonymized: no names, emails, precise
 * location, or PII-bearing free text ever appears (see the PII scrub below).
 *
 * Why question TEXT comes from `reports`, not telemetry: by privacy design the
 * `question_edited` event carries only {action, questionId} — never the typed
 * text. The user-added question text lives, legitimately and server-side, on
 * the finished report (`questions[].origin === "user"`). So ADD candidates are
 * normalized from that store (still PII-scrubbed), while the telemetry
 * `question_edited`/`added` count corroborates the volume signal. DEMOTE
 * candidates come purely from telemetry (the removed questionId is enough).
 */

// --- privacy: same conservative patterns the ingest guard uses (db.ts) -------
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(?:\d[\s\-.()]?){9,}\d/;

function hasPiiLikeText(value: string): boolean {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value);
}

// Surface everything with a count so reviewers prioritize by frequency; a
// single removal is worth flagging, so the demote floor is 1.
const MIN_ADD_OCCURRENCES = 1;
const MIN_DEMOTE_OCCURRENCES = 1;
const MAX_CANDIDATES = 50;
const MAX_EXAMPLES = 3;

export interface AddCandidate {
  /** Normalized grouping key shown as the suggested question text. */
  normalizedText: string;
  /** How many user-added questions normalized to this key. */
  count: number;
  /** A few PII-scrubbed raw examples for the reviewer. */
  examples: string[];
}

export interface DemoteCandidate {
  questionId: string;
  playbookId: CategoryId | "unknown";
  /** Resolved playbook template, or null if the id is no longer in any playbook. */
  template: string | null;
  removedCount: number;
}

export interface EvalCaseExpectation {
  category: CategoryId;
  queryType: QueryType;
  minSources: number;
  minSourceClasses: number;
  /** Left empty for the reviewer to fill; never invented from user text. */
  assumptionHints: string[];
}

export interface EvalCaseCandidate {
  id: string;
  /** Why this report was flagged. */
  source: "low-confidence" | "thumbs-down" | "low-confidence+thumbs-down";
  /** The real query when PII-safe, otherwise a generic category placeholder. */
  query: string;
  mode: ResearchMode;
  expect: EvalCaseExpectation;
}

export interface MiningResult {
  generatedAt: string;
  window: { sinceMs: number | null; nowMs: number };
  totals: {
    eventsScanned: number;
    reportsScanned: number;
    userAddedQuestionEvents: number;
  };
  playbookAddCandidates: AddCandidate[];
  playbookDemoteCandidates: DemoteCandidate[];
  evalCaseCandidates: EvalCaseCandidate[];
}

interface EventRow {
  name: string;
  received_at: string;
  props: string;
}

interface ReportRow {
  id: string;
  created_at: string;
  json: string;
}

/** Coarse per-mode grading floors, mirroring evals/golden/queries.json. */
function expectationsForMode(mode: ResearchMode): { minSources: number; minSourceClasses: number } {
  return mode === "quick"
    ? { minSources: 5, minSourceClasses: 2 }
    : { minSources: 8, minSourceClasses: 3 };
}

/** Collapse to a comparison key so paraphrases of the same question group. */
function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && (CATEGORY_IDS as readonly string[]).includes(value);
}

function isQueryType(value: unknown): value is QueryType {
  return typeof value === "string" && (QUERY_TYPES as readonly string[]).includes(value);
}

function isResearchMode(value: unknown): value is ResearchMode {
  return typeof value === "string" && (RESEARCH_MODES as readonly string[]).includes(value);
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Resolve a playbook question id to its template across all playbooks. */
function findPlaybookTemplate(questionId: string): { playbookId: CategoryId; template: string } | null {
  for (const playbook of Object.values(PLAYBOOKS)) {
    const question = playbook.questions.find((q) => q.id === questionId);
    if (question) return { playbookId: playbook.id, template: question.template };
  }
  return null;
}

interface ReportFacts {
  query: string;
  category: CategoryId;
  queryType: QueryType;
  mode: ResearchMode;
}

function withinWindow(receivedAt: string, sinceMs: number | null, nowMs: number): boolean {
  const t = Date.parse(receivedAt);
  if (Number.isNaN(t)) return true; // keep rows with unreadable timestamps rather than silently drop
  if (sinceMs !== null && t < sinceMs) return false;
  return t <= nowMs;
}

export function mineSignals(opts: { sinceMs?: number; nowMs?: number } = {}): MiningResult {
  const nowMs = opts.nowMs ?? Date.now();
  const sinceMs = opts.sinceMs ?? null;
  const db = getDb();

  const eventRows = db
    .prepare<[], EventRow>("SELECT name, received_at, props FROM telemetry_events")
    .all()
    .filter((row) => withinWindow(row.received_at, sinceMs, nowMs));

  const reportRows = db
    .prepare<[], ReportRow>("SELECT id, created_at, json FROM reports")
    .all()
    .filter((row) => withinWindow(row.created_at, sinceMs, nowMs));

  // Index report facts once for eval-case lookups + user-question mining.
  const reportFacts = new Map<string, ReportFacts>();
  const addGroups = new Map<string, { count: number; examples: string[] }>();

  for (const row of reportRows) {
    const report = safeParse(row.json);
    if (!report) continue;

    const category = isCategoryId(report.category)
      ? report.category
      : isCategoryId((report.category as Record<string, unknown> | undefined)?.id)
        ? ((report.category as Record<string, unknown>).id as CategoryId)
        : "other";
    const meta = report.meta as Record<string, unknown> | undefined;
    const mode = isResearchMode(meta?.mode) ? meta.mode : "full";
    const queryType = isQueryType(report.queryType) ? report.queryType : "need";
    const query = typeof report.query === "string" ? report.query : "";
    reportFacts.set(row.id, { query, category, queryType, mode });

    // ADD candidates: user-authored questions carried into the finished report.
    const questions = Array.isArray(report.questions) ? report.questions : [];
    for (const q of questions) {
      const question = q as Record<string, unknown>;
      if (question.origin !== "user") continue;
      const raw = typeof question.text === "string" ? question.text.trim() : "";
      // Strip HTML tags / stray angle brackets from untrusted user text so no
      // live markup (e.g. an <img onerror> payload) reaches the COMMITTED
      // mining artifacts. Inert in markdown, but committed files stay clean.
      const text = raw.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
      if (!text || hasPiiLikeText(text)) continue; // never surface PII-bearing text
      const key = normalizeQuestion(text);
      if (!key) continue;
      const group = addGroups.get(key) ?? { count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < MAX_EXAMPLES && !group.examples.includes(text)) {
        group.examples.push(text);
      }
      addGroups.set(key, group);
    }
  }

  // Telemetry aggregates.
  let userAddedQuestionEvents = 0;
  const demoteCounts = new Map<string, number>();
  const lowConfidenceReportIds = new Set<string>();
  const thumbsDownReportIds = new Set<string>();

  for (const row of eventRows) {
    const props = safeParse(row.props);
    if (!props) continue;
    switch (row.name) {
      case "question_edited": {
        if (props.action === "added") userAddedQuestionEvents += 1;
        else if (props.action === "removed" && typeof props.questionId === "string") {
          demoteCounts.set(props.questionId, (demoteCounts.get(props.questionId) ?? 0) + 1);
        }
        break;
      }
      case "report_completed": {
        if (props.confidence === "low" && typeof props.reportId === "string") {
          lowConfidenceReportIds.add(props.reportId);
        }
        break;
      }
      case "report_feedback": {
        if (props.rating === "down" && typeof props.reportId === "string") {
          thumbsDownReportIds.add(props.reportId);
        }
        break;
      }
      default:
        break;
    }
  }

  const playbookAddCandidates: AddCandidate[] = [...addGroups.entries()]
    .filter(([, group]) => group.count >= MIN_ADD_OCCURRENCES)
    .map(([normalizedText, group]) => ({
      normalizedText,
      count: group.count,
      examples: group.examples,
    }))
    .sort((a, b) => b.count - a.count || a.normalizedText.localeCompare(b.normalizedText))
    .slice(0, MAX_CANDIDATES);

  const playbookDemoteCandidates: DemoteCandidate[] = [...demoteCounts.entries()]
    .filter(([, count]) => count >= MIN_DEMOTE_OCCURRENCES)
    .map(([questionId, removedCount]): DemoteCandidate => {
      const resolved = findPlaybookTemplate(questionId);
      return {
        questionId,
        playbookId: resolved?.playbookId ?? "unknown",
        template: resolved?.template ?? null,
        removedCount,
      };
    })
    .sort((a, b) => b.removedCount - a.removedCount || a.questionId.localeCompare(b.questionId));

  const evalCaseCandidates = buildEvalCases(
    lowConfidenceReportIds,
    thumbsDownReportIds,
    reportFacts,
  );

  return {
    generatedAt: new Date(nowMs).toISOString(),
    window: { sinceMs, nowMs },
    totals: {
      eventsScanned: eventRows.length,
      reportsScanned: reportRows.length,
      userAddedQuestionEvents,
    },
    playbookAddCandidates,
    playbookDemoteCandidates,
    evalCaseCandidates,
  };
}

function buildEvalCases(
  lowConfidence: Set<string>,
  thumbsDown: Set<string>,
  facts: Map<string, ReportFacts>,
): EvalCaseCandidate[] {
  const reportIds = new Set<string>([...lowConfidence, ...thumbsDown]);
  const cases: EvalCaseCandidate[] = [];

  for (const reportId of reportIds) {
    const isLow = lowConfidence.has(reportId);
    const isDown = thumbsDown.has(reportId);
    const source: EvalCaseCandidate["source"] =
      isLow && isDown ? "low-confidence+thumbs-down" : isLow ? "low-confidence" : "thumbs-down";

    const fact = facts.get(reportId);
    const category = fact?.category ?? "other";
    const queryType = fact?.queryType ?? "need";
    const mode = fact?.mode ?? "full";
    // Anonymize: only keep the literal query when it is PII-safe; otherwise a
    // generic, reviewable placeholder derived from category + query type.
    const rawQuery = fact?.query ?? "";
    const query =
      rawQuery && !hasPiiLikeText(rawQuery)
        ? rawQuery
        : `[${category} ${queryType} query — needs a representative example]`;
    const floors = expectationsForMode(mode);

    cases.push({
      id: `mined-${isLow && isDown ? "flagged" : isLow ? "lowconf" : "thumbsdown"}-${reportId}`,
      source,
      query,
      mode,
      expect: {
        category,
        queryType,
        minSources: floors.minSources,
        minSourceClasses: floors.minSourceClasses,
        assumptionHints: [],
      },
    });
  }

  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
