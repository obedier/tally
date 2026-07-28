import {
  CATEGORY_IDS,
  CONFIDENCE_LEVELS,
  RETAILER_KINDS,
  ReportSchema,
  type Alternative,
  type Assumption,
  type CategoryId,
  type Confidence,
  type HoursSaved,
  type Location,
  type PlanQuestion,
  type PriceRange,
  type ProductPick,
  type QueryType,
  type Report,
  type ResearchMode,
  type RetailerListing,
  type SourceClass,
  type StageTiming,
  type Verdict,
} from "../../shared/report";
import { buildSources, type RawChunk } from "./sources";

/**
 * Pure sanitize + assemble step: raw synthesis JSON -> validated Report.
 * Clamps numbers, drops malformed alternatives/retailers instead of failing
 * the whole report, dedupes sources, and enforces the S5 honesty rule.
 */

export const ENGINE_VERSION = "1.0.0";
const MIN_SOURCES_FOR_FULL_CONFIDENCE = 8;
const MIN_SOURCE_CLASSES = 3;
const NO_EVIDENCED_PROS = "No clearly evidenced strengths were captured — see sources.";
const NO_EVIDENCED_CONS =
  "The sources reviewed didn't surface a clear drawback — treat that as a coverage gap, not proof of perfection.";
const FALLBACK_DECISIVE_FACTOR =
  "The overall balance of evidence rather than a single decisive factor.";

export class SanitizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanitizeError";
  }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strArr = (v: unknown, max: number): string[] =>
  arr(v)
    .map(str)
    .filter((s): s is string => s !== null)
    .slice(0, max);
const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return round2(v);
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (m !== null) {
      const n = Number(m[0]);
      if (Number.isFinite(n) && n >= 0) return round2(n);
    }
  }
  return null;
};

const extractNumbers = (s: string): number[] =>
  (s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .map(round2);

const clampRating = (v: unknown): number | null => {
  const n = toNumber(v);
  return n === null ? null : Math.min(5, n);
};

function formatDisplay(min: number | null, max: number | null, currency: string): string | null {
  const sym = currency === "USD" ? "$" : `${currency} `;
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  if (min !== null && max !== null) {
    return min === max ? `${sym}${fmt(min)}` : `${sym}${fmt(min)}–${sym}${fmt(max)}`;
  }
  const single = min ?? max;
  return single === null ? null : `${sym}${fmt(single)}`;
}

export type PriceInput = {
  readonly min?: unknown;
  readonly max?: unknown;
  readonly display?: unknown;
  readonly currency?: unknown;
};

/**
 * Parses model price fields into the contract's PriceRange. Numbers are
 * clamped nonnegative; when only a display string exists ("$499.99–$649.99"),
 * bounds are extracted from it; no numeric evidence -> nulls + "Check retailer".
 */
export function parsePrice(input: PriceInput): PriceRange {
  const displayRaw = str(input.display);
  const parsedMin = toNumber(input.min);
  const parsedMax = toNumber(input.max);
  const fromDisplay =
    parsedMin === null && parsedMax === null && displayRaw !== null
      ? extractNumbers(displayRaw)
      : [];
  const first = fromDisplay[0] ?? null;
  const second = fromDisplay[1] ?? null;
  const rawLo = parsedMin ?? first;
  const rawHi = parsedMax ?? second ?? first;
  const bothKnown = rawLo !== null && rawHi !== null;
  const min = bothKnown && rawLo > rawHi ? rawHi : rawLo;
  const max = bothKnown && rawLo > rawHi ? rawLo : rawHi;
  const currencyRaw = str(input.currency)?.toUpperCase() ?? "USD";
  const currency = /^[A-Z]{3}$/.test(currencyRaw) ? currencyRaw : "USD";
  const display = displayRaw ?? formatDisplay(min, max, currency) ?? "Check retailer";
  return { min, max, currency, display };
}

const hasPriceEvidence = (r: Rec): boolean =>
  toNumber(r.priceMin) !== null || toNumber(r.priceMax) !== null || str(r.priceDisplay) !== null;

const priceFrom = (r: Rec): PriceRange =>
  parsePrice({ min: r.priceMin, max: r.priceMax, display: r.priceDisplay, currency: r.currency });

/**
 * Independence rule (CLAUDE.md non-negotiable #1): Tally must never route a
 * purchase through anyone's monetized link. Evidence sometimes carries
 * affiliate shorteners as "retailer" URLs (a live report shipped geni.us as
 * Amazon); those domains are dropped outright, and Amazon affiliate tags are
 * stripped from otherwise-direct links.
 */
const AFFILIATE_HOSTS = new Set([
  "geni.us",
  "amzn.to",
  "bit.ly",
  "tinyurl.com",
  "shareasale.com",
  "click.linksynergy.com",
  "go.linkby.com",
  "go.skimresources.com",
  "howl.me",
  "rstyle.me",
  "shop-links.co",
  "prf.hn",
  "avantlink.com",
  "t.co",
  "shopstyle.it",
]);

export const safeUrl = (v: unknown): string | null => {
  const s = str(v);
  if (s === null) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (AFFILIATE_HOSTS.has(host)) return null;
    if (/(^|\.)amazon\./.test(host) && u.searchParams.has("tag")) {
      u.searchParams.delete("tag");
      return u.toString();
    }
    return s;
  } catch {
    return null;
  }
};

function buildVerdict(raw: unknown): Verdict {
  const r = rec(raw);
  const headline = str(r?.headline);
  const rationale = str(r?.rationale);
  const confidenceReason = str(r?.confidenceReason);
  if (r === null || headline === null || rationale === null || confidenceReason === null) {
    throw new SanitizeError("Synthesis output is missing required verdict fields");
  }
  const confRaw = str(r.confidence)?.toLowerCase() ?? "";
  const confidence: Confidence = (CONFIDENCE_LEVELS as readonly string[]).includes(confRaw)
    ? (confRaw as Confidence)
    : "low";
  const factors = strArr(r.decisiveFactors, 3);
  return {
    headline,
    rationale,
    confidence,
    confidenceReason,
    decisiveFactors: factors.length > 0 ? factors : [FALLBACK_DECISIVE_FACTOR],
  };
}

function buildBestFit(raw: unknown, knownSourceIds: ReadonlySet<string>, rationale: string): ProductPick {
  const r = rec(raw);
  const name = str(r?.name);
  if (r === null || name === null) {
    throw new SanitizeError("Synthesis output is missing the best-fit product");
  }
  const pros = strArr(r.pros, 8);
  const cons = strArr(r.cons, 8);
  const ratingSummary = str(r.ratingSummary);
  return {
    name,
    priceRange: priceFrom(r),
    rating: ratingSummary === null ? null : { value: clampRating(r.ratingValue), outOf: 5, summary: ratingSummary },
    pros: pros.length > 0 ? pros : [NO_EVIDENCED_PROS],
    cons: cons.length > 0 ? cons : [NO_EVIDENCED_CONS],
    whyBest: str(r.whyBest) ?? rationale,
    sourceIds: strArr(r.sourceIds, 30).filter((id) => knownSourceIds.has(id)),
    imageUrl: null,
  };
}

/**
 * Malformed entries (missing name/note) are dropped, ranks reassigned from 2,
 * exactly one key alternative kept. Per-competitor pros/cons are clamped to 4
 * and reviewSummary carried through — all left empty when the model omitted
 * them (the contract never fabricates comparison depth; M3 gate 1).
 */
function buildAlternatives(raw: unknown): Alternative[] {
  const picked = arr(raw)
    .flatMap((item) => {
      const r = rec(item);
      const name = str(r?.name);
      const note = str(r?.note);
      if (r === null || name === null || note === null) return [];
      return [
        {
          name,
          note,
          key: r.isKeyAlternative === true,
          ratingValue: clampRating(r.ratingValue),
          priceRange: hasPriceEvidence(r) ? priceFrom(r) : null,
          pros: strArr(r.pros, 4),
          cons: strArr(r.cons, 4),
          reviewSummary: str(r.reviewSummary),
        },
      ];
    })
    .slice(0, 10);
  const firstKey = picked.findIndex((p) => p.key);
  const keyIndex = firstKey === -1 ? 0 : firstKey;
  return picked.map((p, i) => ({
    rank: i + 2,
    imageUrl: null,
    name: p.name,
    priceRange: p.priceRange,
    ratingValue: p.ratingValue,
    note: p.note,
    pros: p.pros,
    cons: p.cons,
    reviewSummary: p.reviewSummary,
    isKeyAlternative: i === keyIndex,
  }));
}

/** First meaningful token of a product/brand name, lowercased. */
const brandToken = (name: string): string =>
  (name.trim().split(/\s+/)[0] ?? "").toLowerCase();

/**
 * Trust rule: the retailers list is for the BEST FIT product only. Drop rows
 * whose seller is a competitor brand (its own store selling its own product),
 * which otherwise reads as a price for the best fit.
 */
function isCompetitorBrandSeller(
  seller: string,
  bestFitName: string | null,
  alternativeNames: readonly string[],
): boolean {
  const sellerToken = brandToken(seller);
  if (sellerToken.length < 3) return false;
  const bestToken = bestFitName === null ? "" : brandToken(bestFitName);
  if (sellerToken === bestToken) return false;
  return alternativeNames.some((alt) => {
    const altToken = brandToken(alt);
    return altToken !== bestToken && (sellerToken === altToken || sellerToken.startsWith(altToken) || altToken.startsWith(sellerToken));
  });
}

function buildRetailers(
  raw: unknown,
  bestFitName: string | null,
  alternativeNames: readonly string[],
): RetailerListing[] {
  return arr(raw)
    .flatMap((item) => {
      const r = rec(item);
      const seller = str(r?.seller);
      if (r === null || seller === null) return [];
      if (isCompetitorBrandSeller(seller, bestFitName, alternativeNames)) return [];
      const kindRaw = str(r.kind) ?? "";
      const kind = (RETAILER_KINDS as readonly string[]).includes(kindRaw)
        ? (kindRaw as (typeof RETAILER_KINDS)[number])
        : "online";
      // Locality only applies to rows with a local footprint; online-only rows
      // are always null so a fabricated place can't leak in on an online seller.
      const locality = kind === "online" ? null : str(r.locality);
      return [
        {
          seller,
          kind,
          price: priceFrom(r),
          availability: str(r.availability) ?? "Check retailer",
          url: safeUrl(r.url),
          locality,
        },
      ];
    })
    .slice(0, 12);
}

const reasonStatesGap = (reason: string): boolean =>
  /(only|few|limited|single|narrow|lack|weak|insufficient|fewer|small|thin)/i.test(reason) &&
  /(sourc|class|diversit|evidence|coverage)/i.test(reason);

/**
 * S5 honesty rule: fewer than 8 sources or fewer than 3 distinct source
 * classes caps confidence at "medium" and forces the confidenceReason to
 * state the gap explicitly (appending a sentence if the model didn't).
 */
function enforceSourceDiversity(
  verdict: Verdict,
  sourceCount: number,
  classes: readonly SourceClass[],
): Verdict {
  if (sourceCount >= MIN_SOURCES_FOR_FULL_CONFIDENCE && classes.length >= MIN_SOURCE_CLASSES) {
    return verdict;
  }
  const confidence: Confidence = verdict.confidence === "low" ? "low" : "medium";
  const suffix = ` Evidence coverage is limited — ${sourceCount} source${sourceCount === 1 ? "" : "s"} across ${classes.length} source class${classes.length === 1 ? "" : "es"} — so confidence is capped at ${confidence}.`;
  return {
    ...verdict,
    confidence,
    confidenceReason: reasonStatesGap(verdict.confidenceReason)
      ? verdict.confidenceReason
      : verdict.confidenceReason + suffix,
  };
}

export type AssembleInput = {
  readonly reportId: string;
  readonly query: string;
  readonly createdAt: string;
  readonly queryType: QueryType;
  readonly category: { readonly id: CategoryId; readonly label: string; readonly confidence: number };
  readonly assumptions: readonly Assumption[];
  readonly questions: readonly PlanQuestion[];
  /** Coarse buyer location used to scope local retailers; null when unknown. */
  readonly location?: Location | null;
  /** Raw parsed JSON from the synthesize stage. */
  readonly synthesis: unknown;
  readonly rawSources: readonly RawChunk[];
  /** Honest estimate derived by the pipeline from real observables; null when unavailable. */
  readonly hoursSaved?: HoursSaved | null;
  readonly meta: {
    readonly model: string;
    readonly mode: ResearchMode;
    readonly stageTimings: readonly StageTiming[];
    readonly totalMs: number;
    readonly promptVersions: Record<string, string>;
    readonly playbookId: string;
    readonly playbookVersion: string;
    readonly evidenceDisagreements: readonly string[];
  };
};

/**
 * Near-duplicate dedupe for "where sources disagree": evidence batches and
 * synthesis restate the same conflict in different words (prefix keys miss
 * them — a real report shipped the clamping-force dispute four times). Items
 * whose content-word overlap with an already-kept item exceeds half the
 * smaller set are dropped; the section is hard-capped so it stays a readable
 * digest, not a word wall. Pure.
 */
export function dedupeDisagreements(items: readonly string[]): string[] {
  const contentWords = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const keptWordSets: Set<string>[] = [];
  const keptLabels = new Set<string>();
  return items
    .map((s) => s.trim())
    .filter((s) => {
      if (s === "") return false;
      const words = contentWords(s);
      if (words.size === 0) return false;
      // "Topic label:" prefixes repeat verbatim across restatements.
      const colon = s.indexOf(":");
      const label =
        colon > 0 && colon < 60 ? s.slice(0, colon).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : null;
      if (label !== null && keptLabels.has(label)) return false;
      for (const kept of keptWordSets) {
        let overlap = 0;
        for (const w of words) if (kept.has(w)) overlap += 1;
        if (overlap / Math.min(words.size, kept.size) > 0.35) return false;
      }
      if (label !== null) keptLabels.add(label);
      keptWordSets.push(words);
      return true;
    })
    .slice(0, 5);
}

export function assembleReport(input: AssembleInput): Report {
  const synth = rec(input.synthesis);
  if (synth === null) throw new SanitizeError("Synthesis output is not a JSON object");

  const bestFitName = str(rec(synth.bestFit)?.name);
  const sources = buildSources(input.rawSources, bestFitName);
  const knownSourceIds = new Set(sources.map((s) => s.id));
  const classes = [...new Set(sources.map((s) => s.sourceClass))];

  const verdictBase = buildVerdict(synth.verdict);
  const verdict = enforceSourceDiversity(verdictBase, sources.length, classes);
  const bestFit = buildBestFit(synth.bestFit, knownSourceIds, verdictBase.rationale);
  const disagreements = dedupeDisagreements([
    ...input.meta.evidenceDisagreements,
    ...strArr(synth.disagreements, 10),
  ]);

  // Post-evidence category correction: when classification was uncertain
  // (e.g. a bare SKU), the synthesize stage re-states the category with
  // evidence in hand; adopt it only when classify confidence was low.
  const check = rec(synth.categoryCheck);
  const checkedId = str(check?.id);
  const applyCorrection =
    input.category.confidence < 0.6 &&
    checkedId !== null &&
    (CATEGORY_IDS as readonly string[]).includes(checkedId) &&
    checkedId !== input.category.id;
  const category = applyCorrection
    ? {
        id: checkedId as CategoryId,
        label: str(check?.label) ?? input.category.label,
        confidence: 0.75,
      }
    : {
        id: input.category.id,
        label: input.category.label,
        confidence: clamp01(input.category.confidence),
      };

  const report: Report = {
    id: input.reportId,
    query: input.query,
    hoursSaved: input.hoursSaved ?? null,
    queryType: input.queryType,
    category,
    createdAt: input.createdAt,
    assumptions: [...input.assumptions],
    questions: [...input.questions],
    verdict,
    bestFit,
    alternatives: buildAlternatives(synth.alternatives),
    retailers: buildRetailers(
      synth.retailers,
      bestFitName,
      arr(synth.alternatives)
        .map((a) => str(rec(a)?.name))
        .filter((n): n is string => n !== null),
    ),
    location: input.location ?? null,
    sources,
    meta: {
      engineVersion: ENGINE_VERSION,
      playbookId: input.meta.playbookId,
      playbookVersion: input.meta.playbookVersion,
      promptVersions: input.meta.promptVersions,
      model: input.meta.model,
      mode: input.meta.mode,
      stageTimings: [...input.meta.stageTimings],
      totalMs: input.meta.totalMs,
      disagreements,
      sourceDiversity: { count: sources.length, classesRepresented: classes },
    },
  };
  return ReportSchema.parse(report);
}
