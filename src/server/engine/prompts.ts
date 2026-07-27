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
};

export type SynthesizePromptArgs = {
  readonly query: string;
  readonly queryType: string;
  readonly categoryLabel: string;
  readonly criteria: readonly string[];
  readonly assumptions: readonly string[];
  readonly evidenceNotes: string;
  readonly sourceList: string;
};

const bullets = (items: readonly string[]): string =>
  items.length > 0 ? items.map((s) => `- ${s}`).join("\n") : "- (none)";

export const PROMPTS = {
  classify: {
    version: "1.1.0",
    build: ({ query }: ClassifyPromptArgs): string => `${PERSONA}

Classify this product-research query and infer the user's situation.

Query: "${query}"

Respond with ONLY a JSON object in exactly this shape:
{
  "queryType": one of "named-product" (a specific model), "need" (a product category to shortlist), "problem" (a situation to solve where the product type may not be chosen yet), "sku" (a retailer catalog identifier such as an Amazon ASIN or a bare model number),
  "category": { "id": one of "consumer-electronics" | "home-goods" | "other", "label": short human-readable category label, "confidence": number between 0 and 1 },
  "assumptions": array of 3 to 5 short statements about the user's likely situation (budget, use case, constraints, location) phrased so the user could read and edit each one, e.g. "You want to stay under about $400.",
  "extraQuestions": array of 0 to 2 objects { "text": a research question specific to THIS query that a generic category playbook would miss, "whyItMatters": one sentence }
}

Rules:
- Assumptions are editable statements about the user's situation, never questions.
- Only infer what the query reasonably supports; do not invent personal details.
- Extra questions must be answerable from public web research (reviews, specs, tests, prices). NEVER phrase a question addressed to the user ("What flooring do you have?") — anything that needs the user's input belongs in assumptions instead.
- If the query looks like a SKU or catalog identifier you cannot resolve without search, use category "other" with low confidence; research will refine it.
- If nothing query-specific is needed beyond a standard playbook, return an empty extraQuestions array.`,
  },

  evidence: {
    version: "1.0.0",
    build: ({ query, categoryLabel, criteria, assumptions, questions }: EvidencePromptArgs): string => `${PERSONA}

Research task for the query: "${query}" (category: ${categoryLabel}).

User assumptions to honor:
${bullets(assumptions)}

Use Google Search to gather CURRENT evidence answering these research questions:
${questions.map((q) => `- [${q.id}] ${q.text}`).join("\n")}

Category criteria that matter: ${criteria.join("; ")}.

${ANTI_FABRICATION_RULE}
Report prices as plain numbers only when the search evidence actually shows them; otherwise use null.
Note explicitly where sources disagree with each other and where data looks stale or outdated.
Include retailer URLs only when they appeared in the evidence.

Respond with ONLY a JSON object (no markdown fences, no commentary before or after):
{
  "candidates": [ { "name": string, "priceMin": number or null, "priceMax": number or null, "currency": "USD", "reviewThemes": [ short strings summarizing what reviews agree on ], "retailerMentions": [ { "seller": string, "url": string or null } ], "notes": string or null } ],
  "findings": [ { "questionId": one of the ids above, "summary": string } ],
  "disagreements": [ strings describing concrete conflicts between sources ]
}
Order candidates best-first for this user's assumptions.`,
  },

  synthesize: {
    version: "1.1.0",
    build: ({ query, queryType, categoryLabel, criteria, assumptions, evidenceNotes, sourceList }: SynthesizePromptArgs): string => `${PERSONA}

Synthesize a final product-research report for: "${query}" (query type: ${queryType}, category: ${categoryLabel}).

User assumptions:
${bullets(assumptions)}

Category criteria that matter: ${criteria.join("; ")}.

Evidence notes from grounded web research (your ONLY factual basis — do not add outside claims):
${evidenceNotes}

Sources gathered (refer to them by id in "sourceIds"):
${sourceList}

${ANTI_FABRICATION_RULE}
Rules:
- The verdict "headline" is ONE short sentence, at most 18 words, that a user could repeat verbatim to a friend. Put the full reasoning in "rationale", not the headline.
- "confidenceReason" must honestly describe the strength AND the gaps of the evidence; never claim confidence the sources do not support.
- Rank alternatives best-first. Exactly ONE alternative has "isKeyAlternative": true — the strongest pick for a different priority.
- "cons" must contain at least one genuine tradeoff or limitation of the best fit. Every product has one; if reviews were uniformly positive, name what was NOT tested or evidenced.
- "retailers" lists ONLY places selling the chosen best-fit product. Never list a competitor brand's store or a competitor product's price here.
- Retailer "url" only if the evidence contained one; otherwise null. Never invent availability; use "Check retailer" when unknown.
- Rating values only when evidenced; otherwise null. Review summaries describe themes, never invented counts.
- "categoryCheck": re-state the true category of the researched product now that evidence is in: { "id": "consumer-electronics" | "home-goods" | "other", "label": short label }.

Respond with ONLY a JSON object in exactly this shape:
{
  "verdict": { "headline": string, "rationale": string, "confidence": "high" | "medium" | "low", "confidenceReason": string, "decisiveFactors": [ 1 to 3 strings ] },
  "categoryCheck": { "id": string, "label": string },
  "bestFit": { "name": string, "priceMin": number or null, "priceMax": number or null, "currency": "USD", "priceDisplay": string, "ratingValue": number 0-5 or null, "ratingSummary": string or null, "pros": [ strings ], "cons": [ strings ], "whyBest": string, "sourceIds": [ source ids like "s1" ] },
  "alternatives": [ up to 10 of { "name": string, "priceMin": number or null, "priceMax": number or null, "priceDisplay": string or null, "ratingValue": number 0-5 or null, "note": one-sentence tradeoff, "isKeyAlternative": boolean } ],
  "retailers": [ { "seller": string, "kind": "online" | "local" | "online-local", "priceMin": number or null, "priceMax": number or null, "priceDisplay": string or null, "availability": string, "url": string or null } ],
  "disagreements": [ strings ]
}`,
  },
} as const;

export type PromptStage = keyof typeof PROMPTS;

export const promptVersions = (): Record<string, string> => ({
  classify: PROMPTS.classify.version,
  evidence: PROMPTS.evidence.version,
  synthesize: PROMPTS.synthesize.version,
});
