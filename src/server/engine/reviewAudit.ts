/**
 * Second-opinion audit of the product feedback in a finished report.
 *
 * Gemini reads the sources and writes the review digest. Kimi — a different
 * provider, different training, no involvement in producing that digest — is
 * shown the digest and the evidence it was drawn from, and asked one question:
 * does the evidence actually support this?
 *
 * Why this exists: `docs/PRODUCT.md` demands honest uncertainty, and the review
 * digest is the single most fabrication-prone field in a report. A model that
 * summarises "what owners say" has every incentive to sound confident about
 * sentiment no source stated. One model cannot audit itself; a second one can.
 *
 * Design rules, all non-negotiable:
 * - DISAGREEMENT is the product, not a problem to hide. It surfaces to the
 *   reader verbatim.
 * - The audit can never fail a report. Any error, timeout, missing key, or
 *   malformed response yields null, and null renders as "not checked" — never
 *   as "checked and fine".
 * - The auditor never rewrites the digest. It judges; it does not edit.
 */

import { z } from "zod";
import type { SecondOpinion } from "../../shared/report";
import { callKimi, KimiError, type KimiUsage } from "../kimi";

/** Version-stamped like every other prompt, per docs/LEARNING.md. */
export const REVIEW_AUDIT_PROMPT_VERSION = "1.0.0";

const AuditSchema = z.object({
  agrees: z.boolean(),
  note: z.string().min(1).max(300),
});

export type ReviewAuditInput = {
  readonly productName: string;
  /** The review digest Gemini produced — the claim under audit. */
  readonly reviewSummary: string;
  /** Numeric rating Gemini reported, when it reported one. */
  readonly ratingValue: number | null;
  /** Raw grounded evidence notes the digest was drawn from. */
  readonly evidenceNotes: string;
};

/** Bounds the prompt so a long research run can't blow the context window. */
const MAX_EVIDENCE_CHARS = 6000;

export function buildReviewAuditPrompt(input: ReviewAuditInput): string {
  const rating =
    input.ratingValue === null
      ? "(no numeric rating was reported)"
      : `${input.ratingValue} out of 5`;
  return `You are auditing another AI's summary of customer reviews for a product. You did not write it and have no stake in it being right.

PRODUCT: ${input.productName}
REPORTED RATING: ${rating}
REVIEW SUMMARY UNDER AUDIT: "${input.reviewSummary}"

EVIDENCE THE SUMMARY WAS DRAWN FROM:
${input.evidenceNotes.slice(0, MAX_EVIDENCE_CHARS)}

Decide whether the evidence supports the review summary.

Set "agrees": false when the summary states sentiment, themes, counts, or a rating the evidence does not show — including when the evidence is simply too thin to support a confident claim. Overstated confidence counts as disagreement.
Set "agrees": true only when the evidence genuinely backs the summary.

Then write "note": ONE sentence, at most 25 words, in plain second-person English addressed to a shopper. If you disagree, say specifically what is unsupported. If you agree, say what the evidence confirms. Never restate the summary. Never invent review counts or ratings.

Reply with ONLY this JSON, no markdown fences:
{"agrees": true, "note": "..."}`;
}

/**
 * Parses the auditor's reply. Tolerates fenced or prose-wrapped JSON because a
 * chat model will occasionally add one despite instructions.
 */
export function parseReviewAudit(text: string): z.infer<typeof AuditSchema> {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new KimiError("parse", "Kimi audit reply contained no JSON object", true);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new KimiError("parse", "Kimi audit reply was not valid JSON", true);
  }
  const parsed = AuditSchema.safeParse(raw);
  if (!parsed.success) {
    throw new KimiError("parse", "Kimi audit reply failed the audit contract", true);
  }
  return parsed.data;
}

export type ReviewAuditDeps = {
  readonly apiKey: string | null;
  readonly model: string;
  /** Injectable for tests; defaults to the real Kimi client. */
  readonly call?: typeof callKimi;
};

/**
 * The audit plus what it cost. Usage is reported even on a failed parse, since
 * a call that burned tokens and returned nothing still shows up on the bill —
 * omitting it would understate unit economics exactly where it matters.
 */
export type ReviewAuditResult = {
  readonly opinion: SecondOpinion | null;
  readonly usage: KimiUsage;
};

const NO_USAGE: KimiUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Runs the audit. `opinion` is null — meaning "not checked" — whenever the
 * second provider is absent, unreachable, out of quota, or incoherent.
 * Never throws.
 */
export async function auditReviewSummary(
  input: ReviewAuditInput,
  deps: ReviewAuditDeps,
): Promise<ReviewAuditResult> {
  if (deps.apiKey === null) return { opinion: null, usage: NO_USAGE };
  if (input.reviewSummary.trim() === "" || input.evidenceNotes.trim() === "") {
    return { opinion: null, usage: NO_USAGE };
  }
  const call = deps.call ?? callKimi;
  try {
    const { data: audit, usage } = await call(
      {
        apiKey: deps.apiKey,
        model: deps.model,
        prompt: buildReviewAuditPrompt(input),
        // Reasoning tokens count against this; see DEFAULT_MAX_TOKENS in kimi.ts.
        maxTokens: 3000,
      },
      parseReviewAudit,
    );
    return {
      opinion: {
        provider: "kimi",
        model: deps.model,
        agrees: audit.agrees,
        note: audit.note.trim(),
      },
      usage,
    };
  } catch (err) {
    // Logged without the key and without user content: the point of the log is
    // that a disabled cross-check never becomes invisible to the operator.
    const code = err instanceof KimiError ? err.code : "unknown";
    console.error(`[review-audit] second opinion unavailable (${code})`);
    // A failed audit that still burned tokens must appear on the bill.
    return { opinion: null, usage: err instanceof KimiError ? err.usage : NO_USAGE };
  }
}
