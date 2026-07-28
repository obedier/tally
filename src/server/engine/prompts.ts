/**
 * Every prompt is a versioned constant. Reports stamp these versions into
 * meta.promptVersions so quality is attributable per docs/LEARNING.md.
 */

const PERSONA =
  "You are an independent product research analyst. You are decisive when evidence is strong and explicitly honest about uncertainty when it is not. You are never influenced by advertising, retailers, affiliates, or sponsorships.";

/** Carried verbatim into every evidence + synthesis prompt. Non-negotiable. */
export const ANTI_FABRICATION_RULE =
  "Never invent exact review counts, availability, or prices; use ranges or say 'Check retailer' where evidence is weak.";

export type ClassifyPromptArgs = { readonly query: string };

export type EvidencePromptArgs = {
  readonly query: string;
  readonly categoryLabel: string;
  readonly criteria: readonly string[];
  readonly assumptions: readonly string[];
  readonly questions: readonly { readonly id: string; readonly text: string }[];
  /** Coarse buyer location label (e.g. "Seattle, WA"); used to scope local availability. */
  readonly location?: string;
  /** True only when the location was actually detected/set (not a fallback default). */
  readonly locationKnown?: boolean;
  /** Quick mode: fewer candidates, terse findings (S2 latency budget). */
  readonly concise?: boolean;
};

export type EvidenceStructurePromptArgs = {
  /** The grounded free-text research notes from evidence step 1. */
  readonly notes: string;
  /** Valid plan-question ids the findings may reference. */
  readonly questionIds: readonly string[];
};

export type SynthesizePromptArgs = {
  readonly query: string;
  readonly queryType: string;
  readonly categoryLabel: string;
  readonly criteria: readonly string[];
  readonly assumptions: readonly string[];
  readonly evidenceNotes: string;
  readonly sourceList: string;
  /** Coarse buyer location label (e.g. "Seattle, WA"); scopes local retailers. */
  readonly location?: string;
  /** True only when the location was actually detected/set (not a fallback default). */
  readonly locationKnown?: boolean;
  /** Quick mode: at most 5 alternatives, short texts (S2 latency budget). */
  readonly concise?: boolean;
};

const bullets = (items: readonly string[]): string =>
  items.length > 0 ? items.map((s) => `- ${s}`).join("\n") : "- (none)";

export const PROMPTS = {
  classify: {
    version: "1.2.0",
    build: ({ query }: ClassifyPromptArgs): string => `${PERSONA}

Classify this product-research query and infer the user's situation.

Query: "${query}"

Respond with ONLY a JSON object in exactly this shape:
{
  "queryType": one of "named-product" (a specific model), "need" (a product category to shortlist), "problem" (a situation to solve where the product type may not be chosen yet), "sku" (a retailer catalog identifier such as an Amazon ASIN or a bare model number),
  "category": { "id": one of "consumer-electronics" | "home-goods" | "other", "label": short human-readable category label, "confidence": number between 0 and 1 },
  "assumptions": array of 3 to 5 short DECISION-RELEVANT statements about the user's situation, phrased so the user could read and edit each one, e.g. "You want to stay under about $400.",
  "extraQuestions": array of 0 to 2 objects { "text": a research question specific to THIS query that a generic category playbook would miss, "whyItMatters": one sentence }
}

Rules:
- Assumptions are editable statements about the user's situation, never questions.
- Each assumption MUST be decision-relevant — something that, if wrong, would change which product wins. Cover the dimensions that actually drive THIS purchase: the intended use case, the priority that matters most (e.g. portability, battery life, performance, noise, durability, capacity), budget / price sensitivity, and any key configuration or variant choice (size, memory, finish, model tier).
- NEVER restate the query as an assumption (e.g. for "MacBook Air M4 13 inch" do NOT write "You are looking for a MacBook Air M4 13-inch"). NEVER use empty filler that applies to any query ("You are considering a purchase", "You want a good product", "You are in a region where it is available"). Those waste the user's attention and are forbidden.
- Only infer what the query reasonably supports; do not invent specific personal details.
- Extra questions must be answerable from public web research (reviews, specs, tests, prices). NEVER phrase a question addressed to the user ("What flooring do you have?") — anything that needs the user's input belongs in assumptions instead.
- If the query looks like a SKU or catalog identifier you cannot resolve without search, use category "other" with low confidence; research will refine it.
- If nothing query-specific is needed beyond a standard playbook, return an empty extraQuestions array.`,
  },

  /**
   * Two-step evidence (v2.0.0): newer Gemini models silently skip the search
   * tool when the prompt demands JSON-only output, which would fabricate
   * ungrounded "evidence". Step 1 (this prompt) is grounded FREE TEXT so search
   * actually runs; step 2 (evidenceStructure below, ungrounded) converts the
   * notes to the JSON contract. The version covers the pair.
   */
  evidence: {
    version: "2.1.0",
    build: ({ query, categoryLabel, criteria, assumptions, questions, location, locationKnown, concise }: EvidencePromptArgs): string => `${PERSONA}

Research task for the query: "${query}" (category: ${categoryLabel}).

User assumptions to honor:
${bullets(assumptions)}

Use Google Search to gather CURRENT evidence answering these research questions:
${questions.map((q) => `- [${q.id}] ${q.text}`).join("\n")}

Category criteria that matter: ${criteria.join("; ")}.
${
      locationKnown === true && location !== undefined && location.trim() !== ""
        ? `Buyer location: ${location}. Where the sources support it, note local or in-store availability near ${location}; never invent local stores.\n`
        : ""
    }
${ANTI_FABRICATION_RULE}
Write your findings as plain-text research notes with exactly these sections:

FINDINGS — one short paragraph per question, each starting with its id in brackets (e.g. [${questions[0]?.id ?? "q1"}]), summarizing what current sources actually show.

CANDIDATES — the products in contention, best-first for this user's assumptions. For each: its name, then ONLY facts the sources state — price range in USD, average rating out of 5 (convert 10-point scales), what reviews agree on, retailer names and URLs that appeared in the evidence, whether it is discontinued or has a direct successor, and one honest note. Actively look up each candidate's average customer rating (retailer or review-site aggregate) — including the queried product itself — and report it whenever any source shows one.

DISAGREEMENTS — concrete conflicts between sources, and anything that looks stale or outdated.

Report prices as numbers only when the search evidence actually shows them. Never estimate a rating no source states. Omit anything the sources don't support — never fill gaps from memory.${
      concise === true
        ? "\nThis is a QUICK scan: at most 5 candidates and one terse sentence per finding."
        : ""
    }`,
  },

  /** Step 2 of evidence: ungrounded, JSON-only, notes are the ONLY source. */
  evidenceStructure: {
    version: "1.0.0",
    build: ({ notes, questionIds }: EvidenceStructurePromptArgs): string => `${PERSONA}

Convert the research notes below into JSON. The notes are your ONLY factual source — copy facts from them verbatim and use null or [] wherever the notes are silent. Never add outside knowledge, never estimate.

RESEARCH NOTES:
${notes}

Respond with ONLY a JSON object (no markdown fences, no commentary before or after):
{
  "candidates": [ { "name": string, "priceMin": number or null, "priceMax": number or null, "currency": "USD", "rating": number 0-5 or null, "reviewThemes": [ short strings summarizing what reviews agree on ], "retailerMentions": [ { "seller": string, "url": string or null } ], "notes": string or null } ],
  "findings": [ { "questionId": one of ${JSON.stringify(questionIds)}, "summary": string } ],
  "disagreements": [ strings describing concrete conflicts between sources ]
}
Keep the candidates in the notes' order (best-first).`,
  },

  synthesize: {
    version: "1.4.0",
    build: ({ query, queryType, categoryLabel, criteria, assumptions, evidenceNotes, sourceList, location, locationKnown, concise }: SynthesizePromptArgs): string => `${PERSONA}

Synthesize a final product-research report for: "${query}" (query type: ${queryType}, category: ${categoryLabel}).

User assumptions:
${bullets(assumptions)}

Category criteria that matter: ${criteria.join("; ")}.
${
      location !== undefined && location.trim() !== ""
        ? `Buyer location: ${location}${locationKnown === true ? " (detected)" : " (default — treat as unknown for local scoping)"}.\n`
        : ""
    }
Evidence notes from grounded web research (your ONLY factual basis — do not add outside claims):
${evidenceNotes}

Sources gathered (refer to them by id in "sourceIds"):
${sourceList}

${ANTI_FABRICATION_RULE}
Rules:
- The verdict "headline" is ONE short sentence, at most 18 words, that a user could repeat verbatim to a friend. Put the full reasoning in "rationale", not the headline.
- "confidenceReason" must honestly describe the strength AND the gaps of the evidence; never claim confidence the sources do not support.
- Rank alternatives best-first. Exactly ONE alternative has "isKeyAlternative": true — the strongest pick for a different priority.
- For EACH alternative, include up to 4 concise "pros" and up to 4 concise "cons" drawn ONLY from the evidence, plus a one-line "reviewSummary" of its review themes. Leave "pros"/"cons" as [] and "reviewSummary" as null when the evidence does not support them — never invent.
- "cons" (best fit) must contain at least one genuine tradeoff or limitation of the best fit. Every product has one; if reviews were uniformly positive, name what was NOT tested or evidenced.
- "retailers" lists ONLY places selling the chosen best-fit product. Never list a competitor brand's store or a competitor product's price here.
- Retailer "url" only if the evidence contained one; otherwise null. Never invent availability; use "Check retailer" when unknown.
- For local or online-local retailer rows, set "locality" to the coarse place the listing applies to${locationKnown === true && location !== undefined && location.trim() !== "" ? ` (e.g. "${location}")` : ""}; use null for online-only rows. Never fabricate a local store — if the evidence is online-only${locationKnown === true ? "" : " or the location is unknown"}, return online rows only and omit local ones.
- Rating values only when evidenced; otherwise null. The evidence notes carry captured "rating" numbers per candidate — use them for "ratingValue" whenever present; do not drop them. Review summaries describe themes, never invented counts.
- If the evidence shows the queried product is discontinued or clearly superseded by a direct successor that is the better buy for these assumptions, the best fit MUST be that successor — say so plainly in the headline — and the queried product appears as a ranked alternative with an honest note. Never keep a product as best fit merely because it was the one searched.
- "categoryCheck": re-state the true category of the researched product now that evidence is in: { "id": "consumer-electronics" | "home-goods" | "other", "label": short label }.

Respond with ONLY a JSON object in exactly this shape:
{
  "verdict": { "headline": string, "rationale": string, "confidence": "high" | "medium" | "low", "confidenceReason": string, "decisiveFactors": [ 1 to 3 strings ] },
  "categoryCheck": { "id": string, "label": string },
  "bestFit": { "name": string, "priceMin": number or null, "priceMax": number or null, "currency": "USD", "priceDisplay": string, "ratingValue": number 0-5 or null, "ratingSummary": string or null, "pros": [ strings ], "cons": [ strings ], "whyBest": string, "sourceIds": [ source ids like "s1" ] },
  "alternatives": [ up to 10 of { "name": string, "priceMin": number or null, "priceMax": number or null, "priceDisplay": string or null, "ratingValue": number 0-5 or null, "note": one-sentence tradeoff, "pros": [ up to 4 short strings ], "cons": [ up to 4 short strings ], "reviewSummary": string or null, "isKeyAlternative": boolean } ],
  "retailers": [ { "seller": string, "kind": "online" | "local" | "online-local", "priceMin": number or null, "priceMax": number or null, "priceDisplay": string or null, "availability": string, "url": string or null, "locality": string or null } ],
  "disagreements": [ strings ]
}${
      concise === true
        ? "\nThis is a QUICK report: include at most 5 alternatives and keep every prose field to one or two short sentences."
        : ""
    }`,
  },
} as const;

export type PromptStage = keyof typeof PROMPTS;

export const promptVersions = (): Record<string, string> => ({
  classify: PROMPTS.classify.version,
  evidence: PROMPTS.evidence.version,
  synthesize: PROMPTS.synthesize.version,
});
