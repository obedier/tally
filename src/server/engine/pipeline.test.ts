import { describe, expect, it } from "vitest";
import { resolveAssumptions } from "./pipeline";
import type { AssembleInput } from "./sanitize";
import { assembleReport, dedupeDisagreements, deepRetailerUrl, enforceSourceDiversity, GAP_VOCABULARY, parsePrice, safeUrl, SanitizeError } from "./sanitize";
import { classifySource, domainFromChunk, type RawChunk } from "./sources";

/** Unit tests for the pure sanitize/assemble step. No network. */

const chunk = (title: string, uri: string): RawChunk => ({ title, uri });

const diverseChunks = (): RawChunk[] => [
  chunk("sony.com", "https://www.sony.com/headphones/wh-1000xm5"),
  chunk("amazon.com", "https://www.amazon.com/dp/B09XS7JWHH"),
  chunk("bestbuy.com", "https://www.bestbuy.com/site/sony-wh1000xm5"),
  chunk("rtings.com", "https://www.rtings.com/headphones/reviews/sony/wh-1000xm5"),
  chunk("nytimes.com", "https://www.nytimes.com/wirecutter/reviews/best-headphones"),
  chunk("reddit.com", "https://www.reddit.com/r/headphones/comments/xm5"),
  chunk("youtube.com", "https://www.youtube.com/watch?v=xm5review"),
  chunk("cnet.com", "https://www.cnet.com/tech/sony-wh-1000xm5-review"),
];

const baseSynthesis = (): Record<string, unknown> => ({
  verdict: {
    headline: "Buy the Sony WH-1000XM5 — it is the best all-round pick.",
    rationale: "Editorial testers and long-term owners agree on comfort and ANC.",
    confidence: "high",
    confidenceReason: "Strong agreement across independent testing and owner reviews.",
    decisiveFactors: ["ANC quality", "Comfort"],
  },
  bestFit: {
    name: "Sony WH-1000XM5",
    priceMin: 328,
    priceMax: 399.99,
    currency: "USD",
    priceDisplay: "$328–$399.99",
    ratingValue: 4.5,
    ratingSummary: "Owners praise comfort and battery; some miss the folding design.",
    pros: ["Best-in-class noise cancelling"],
    cons: ["No folding hinge"],
    whyBest: "Fits the commute-heavy use case with top ANC at a mid price.",
    sourceIds: ["s1", "s4", "nonexistent"],
  },
  alternatives: [],
  retailers: [],
  disagreements: [],
});

const baseInput = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  reportId: "report-test-1",
  query: "Sony WH-1000XM5",
  createdAt: new Date().toISOString(),
  queryType: "named-product",
  category: { id: "consumer-electronics", label: "Consumer electronics", confidence: 0.95 },
  assumptions: [{ id: "a1", text: "You commute regularly.", origin: "inferred", affirmed: true }],
  questions: [
    { id: "ce-fit", text: "Which current models fit?", status: "done", whyItMatters: null, origin: "playbook", sourceCount: 4 },
  ],
  synthesis: baseSynthesis(),
  rawSources: diverseChunks(),
  meta: {
    model: "gemini-2.5-flash",
    mode: "quick",
    stageTimings: [{ stage: "classify", ms: 800, retries: 0 }],
    totalMs: 24_000,
    promptVersions: { classify: "1.0.0", evidence: "1.0.0", synthesize: "1.0.0" },
    playbookId: "consumer-electronics",
    playbookVersion: "1.0.0",
    evidenceDisagreements: [],
  },
  ...over,
});

describe("resolveAssumptions (M3 gate 3 — re-run with edited assumptions)", () => {
  it("uses classifier inferences when no seeds are given", () => {
    const out = resolveAssumptions(undefined, ["You commute daily.", "  ", "You want ANC."]);
    expect(out).toEqual([
      { id: "a1", text: "You commute daily.", origin: "inferred", affirmed: true },
      { id: "a2", text: "You want ANC.", origin: "inferred", affirmed: true },
    ]);
  });

  it("seeds REPLACE inferences, carry origin 'user' and the affirmed flag", () => {
    const out = resolveAssumptions(
      [
        { text: "You want under $300.", affirmed: true },
        { text: "You care about brand.", affirmed: false },
      ],
      ["ignored inference"],
    );
    expect(out).toEqual([
      { id: "a1", text: "You want under $300.", origin: "user", affirmed: true },
      { id: "a2", text: "You care about brand.", origin: "user", affirmed: false },
    ]);
  });

  it("trims/drops empty seed texts and caps at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `seed ${i}`, affirmed: true }));
    expect(resolveAssumptions(many, [])).toHaveLength(8);
    expect(resolveAssumptions([{ text: "  ", affirmed: true }], ["fallback"])).toEqual([
      { id: "a1", text: "fallback", origin: "inferred", affirmed: true },
    ]);
  });
});

describe("parsePrice", () => {
  it("extracts numeric bounds from a display-only string", () => {
    const price = parsePrice({ display: "$499.99–$649.99" });
    expect(price.min).toBe(499.99);
    expect(price.max).toBe(649.99);
    expect(price.display).toBe("$499.99–$649.99");
    expect(price.currency).toBe("USD");
  });

  it("returns null bounds and keeps 'Check retailer' when there is no numeric evidence", () => {
    const price = parsePrice({ display: "Check retailer" });
    expect(price.min).toBeNull();
    expect(price.max).toBeNull();
    expect(price.display).toBe("Check retailer");
  });

  it("falls back to 'Check retailer' when nothing is provided", () => {
    expect(parsePrice({}).display).toBe("Check retailer");
  });

  it("clamps and orders numeric min/max, parsing string numbers", () => {
    const price = parsePrice({ min: "649.99", max: 499.99 });
    expect(price.min).toBe(499.99);
    expect(price.max).toBe(649.99);
    expect(parsePrice({ min: -5 }).min).toBeNull();
  });
});

describe("classifySource", () => {
  it("classifies by domain heuristics", () => {
    expect(classifySource("amazon.com", null)).toBe("retailer");
    expect(classifySource("rtings.com", null)).toBe("editorial");
    expect(classifySource("reddit.com", null)).toBe("owner-review");
    expect(classifySource("forums.macrumors.com", null)).toBe("owner-review");
    expect(classifySource("dyson.com", null)).toBe("manufacturer");
    expect(classifySource("random-blog.net", null)).toBe("other");
  });

  it("uses the best-fit brand name to spot manufacturer domains", () => {
    expect(classifySource("ridgeflex.com", "RidgeFlex X2 Pro")).toBe("manufacturer");
    expect(classifySource("ridgeflex.com", null)).toBe("other");
  });
});

describe("domainFromChunk", () => {
  it("keeps the redirect href but takes the domain from a domain-looking title", () => {
    const c = chunk("rtings.com", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc");
    expect(domainFromChunk(c)).toBe("rtings.com");
  });

  it("falls back to google-grounding when the title is not a domain", () => {
    const c = chunk("Sony WH-1000XM5 Review", "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc");
    expect(domainFromChunk(c)).toBe("google-grounding");
  });
});

describe("assembleReport", () => {
  it("produces a schema-valid report and filters unknown sourceIds", () => {
    const report = assembleReport(baseInput());
    expect(report.id).toBe("report-test-1");
    expect(report.bestFit.sourceIds).toEqual(["s1", "s4"]);
    expect(report.meta.engineVersion).toBe("1.0.0");
    expect(report.meta.sourceDiversity.count).toBe(8);
  });

  it("drops malformed alternatives, reassigns ranks, and keeps exactly one key alternative", () => {
    const synthesis = {
      ...baseSynthesis(),
      alternatives: [
        { name: "Bose QC Ultra", note: "Better for pure comfort.", isKeyAlternative: true, priceMin: 429 },
        { note: "missing name — must be dropped" },
        { name: "AirPods Max", note: "For Apple-only households.", isKeyAlternative: true },
      ],
    };
    const report = assembleReport(baseInput({ synthesis }));
    expect(report.alternatives).toHaveLength(2);
    expect(report.alternatives.map((a) => a.rank)).toEqual([2, 3]);
    expect(report.alternatives.filter((a) => a.isKeyAlternative)).toHaveLength(1);
    expect(report.alternatives[0]?.isKeyAlternative).toBe(true);
    expect(report.alternatives[1]?.priceRange).toBeNull();
  });

  it("dedupes sources by url and assigns sequential ids", () => {
    const rawSources = [
      chunk("rtings.com", "https://www.rtings.com/review"),
      chunk("rtings.com duplicate", "https://www.rtings.com/review"),
      chunk("amazon.com", "https://www.amazon.com/dp/B0TEST"),
      chunk("bad url", "not a url"),
    ];
    const report = assembleReport(baseInput({ rawSources }));
    expect(report.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(report.sources[0]?.title).toBe("rtings.com");
    expect(report.sources[1]?.domain).toBe("amazon.com");
  });

  it("caps confidence at medium and appends an explicit gap sentence when diversity is weak", () => {
    const rawSources = [
      chunk("amazon.com", "https://www.amazon.com/dp/B0TEST"),
      chunk("bestbuy.com", "https://www.bestbuy.com/site/test"),
      chunk("rtings.com", "https://www.rtings.com/review"),
    ];
    const report = assembleReport(baseInput({ rawSources }));
    expect(report.verdict.confidence).toBe("medium");
    expect(report.verdict.confidenceReason).toContain("3 sources across 2 source classes");
    expect(report.verdict.confidenceReason).toContain("capped at medium");
  });

  it("does not double-state the gap when the model already acknowledged it, but still caps", () => {
    const synthesis = baseSynthesis();
    const verdict = synthesis.verdict as Record<string, unknown>;
    verdict.confidenceReason = "Only a few sources with limited class diversity were available.";
    const rawSources = [chunk("amazon.com", "https://www.amazon.com/dp/B0TEST")];
    const report = assembleReport(baseInput({ synthesis, rawSources }));
    expect(report.verdict.confidence).toBe("medium");
    expect(report.verdict.confidenceReason).toBe(
      "Only a few sources with limited class diversity were available.",
    );
  });

  it("keeps low confidence low (never raises it) under the diversity cap", () => {
    const synthesis = baseSynthesis();
    (synthesis.verdict as Record<string, unknown>).confidence = "low";
    const report = assembleReport(baseInput({ synthesis, rawSources: [chunk("amazon.com", "https://www.amazon.com/dp/B0TEST")] }));
    expect(report.verdict.confidence).toBe("low");
  });

  it("leaves strong-diversity verdicts untouched", () => {
    const report = assembleReport(baseInput());
    expect(report.verdict.confidence).toBe("high");
    expect(report.verdict.confidenceReason).toBe(
      "Strong agreement across independent testing and owner reviews.",
    );
  });

  it("drops malformed retailers, nulls invented urls, and defaults availability honestly", () => {
    const synthesis = {
      ...baseSynthesis(),
      retailers: [
        { seller: "Amazon", kind: "online", priceMin: 328, availability: "In stock", url: "https://www.amazon.com/dp/B09XS7JWHH" },
        { kind: "online", availability: "no seller — dropped" },
        { seller: "Local Hi-Fi", kind: "weird-kind", url: "javascript:alert(1)" },
      ],
    };
    const report = assembleReport(baseInput({ synthesis }));
    expect(report.retailers).toHaveLength(2);
    expect(report.retailers[1]?.kind).toBe("online");
    expect(report.retailers[1]?.url).toBeNull();
    expect(report.retailers[1]?.availability).toBe("Check retailer");
    expect(report.retailers[1]?.price.display).toBe("Check retailer");
  });

  it("throws SanitizeError when the best-fit product is missing", () => {
    const synthesis = { ...baseSynthesis(), bestFit: { pros: [] } };
    expect(() => assembleReport(baseInput({ synthesis }))).toThrow(SanitizeError);
  });

  // Regression: design-critic T1 — competitor brands' own stores rendered as
  // retailer listings for the best fit (their prices read as best-fit prices).
  it("drops competitor-brand sellers from the best-fit retailer list", () => {
    const synthesis = {
      ...baseSynthesis(),
      alternatives: [
        { name: "Bose QuietComfort Ultra", priceDisplay: "$379", note: "Better for planes.", isKeyAlternative: true, ratingValue: null, priceMin: 379, priceMax: 379 },
        { name: "Sennheiser Momentum 4", priceDisplay: "$299", note: "Longer battery.", isKeyAlternative: false, ratingValue: null, priceMin: 299, priceMax: 299 },
      ],
      retailers: [
        { seller: "Amazon", kind: "online", availability: "In stock", url: null },
        { seller: "Bose", kind: "online", availability: "In stock", url: null },
        { seller: "Sennheiser", kind: "online", availability: "In stock", url: null },
        { seller: "Sony", kind: "online", availability: "In stock", url: null },
      ],
    };
    const report = assembleReport(baseInput({ synthesis }));
    const sellers = report.retailers.map((r) => r.seller);
    expect(sellers).toContain("Amazon");
    expect(sellers).toContain("Sony");
    expect(sellers).not.toContain("Bose");
    expect(sellers).not.toContain("Sennheiser");
  });

  // Regression: eval ce-sku-01 — an unresolvable SKU classifies as "other";
  // synthesize's post-evidence categoryCheck corrects it when classify
  // confidence was low, and is ignored when classify was confident.
  it("applies categoryCheck only under low classify confidence", () => {
    const synthesis = {
      ...baseSynthesis(),
      categoryCheck: { id: "consumer-electronics", label: "Consumer electronics" },
    };
    const corrected = assembleReport(
      baseInput({ synthesis, category: { id: "other", label: "General", confidence: 0.3 } }),
    );
    expect(corrected.category.id).toBe("consumer-electronics");

    const homeGoodsCheck = {
      ...baseSynthesis(),
      categoryCheck: { id: "home-goods", label: "Home goods" },
    };
    const untouched = assembleReport(baseInput({ synthesis: homeGoodsCheck }));
    expect(untouched.category.id).toBe("consumer-electronics");
  });
});

describe("assembleReport — comparison depth (M3 gate 1)", () => {
  it("carries and clamps alternative pros/cons to 4 and keeps reviewSummary", () => {
    const synthesis = {
      ...baseSynthesis(),
      alternatives: [
        {
          name: "Bose QuietComfort Ultra",
          note: "Warmer tuning for treble-sensitive listeners.",
          priceMin: 379,
          priceMax: 429,
          priceDisplay: "$379–$429",
          ratingValue: 4.4,
          pros: ["Best-in-class comfort", "Immersive spatial mode", "Strong ANC", "Solid app", "SIXTH pro should drop"],
          cons: ["Pricey", "Shorter battery", "No multipoint at launch", "Bulkier case", "FIFTH con drops"],
          reviewSummary: "Reviewers love the comfort and ANC but flag price.",
          isKeyAlternative: true,
        },
      ],
    };
    const report = assembleReport(baseInput({ synthesis }));
    const alt = report.alternatives[0]!;
    expect(alt).toBeDefined();
    expect(alt.pros).toHaveLength(4);
    expect(alt.cons).toHaveLength(4);
    expect(alt.pros).not.toContain("SIXTH pro should drop");
    expect(alt.reviewSummary).toBe("Reviewers love the comfort and ANC but flag price.");
    expect(alt.isKeyAlternative).toBe(true);
  });

  it("leaves pros/cons empty and reviewSummary null when the model omitted them (no fabrication)", () => {
    const synthesis = {
      ...baseSynthesis(),
      alternatives: [{ name: "Sennheiser Momentum 4", note: "Longer battery life." }],
    };
    const report = assembleReport(baseInput({ synthesis }));
    const alt = report.alternatives[0]!;
    expect(alt.pros).toEqual([]);
    expect(alt.cons).toEqual([]);
    expect(alt.reviewSummary).toBeNull();
  });
});

describe("assembleReport — location + local retailers (M3 gate 2)", () => {
  it("sets report.location and populates locality for local rows, null for online-only", () => {
    const synthesis = {
      ...baseSynthesis(),
      retailers: [
        { seller: "Amazon", kind: "online", priceMin: 328, priceDisplay: "$328", availability: "In stock", url: null, locality: "Seattle, WA" },
        { seller: "Best Buy", kind: "online-local", priceMin: 349, priceDisplay: "$349", availability: "Pickup today", url: null, locality: "Seattle, WA" },
        { seller: "Local Audio Co", kind: "local", priceMin: 359, priceDisplay: "$359", availability: "In store", url: null, locality: "Seattle, WA" },
      ],
    };
    const report = assembleReport(
      baseInput({ synthesis, location: { label: "Seattle, WA", source: "ip" } }),
    );
    expect(report.location).toEqual({ label: "Seattle, WA", source: "ip" });
    const bySeller = Object.fromEntries(report.retailers.map((r) => [r.seller, r]));
    // Online-only row: locality forced null so a place can't leak onto it.
    expect(bySeller["Amazon"]!.locality).toBeNull();
    expect(bySeller["Best Buy"]!.locality).toBe("Seattle, WA");
    expect(bySeller["Local Audio Co"]!.locality).toBe("Seattle, WA");
  });

  it("defaults report.location to null when none is supplied", () => {
    expect(assembleReport(baseInput()).location).toBeNull();
  });
});

// Regression (owner PDF 2026-07-27): a live Bose A20 report shipped the same
// clamping-force dispute four times in "where sources disagree".
describe("dedupeDisagreements", () => {
  it("drops restated conflicts and hard-caps the list", () => {
    const items = [
      "Clamping force and comfort: Some sources state the Bose A30 is the most comfortable headset ever made due to its 20% reduced clamping force compared to the A20.",
      "Sharp divide between pilots regarding the Bose A30's reduced clamping force: Bose markets it as a comfort upgrade, while real-world reviews complain it is too loose and slips off.",
      "Clamping force and comfort: Bose markets the A30's 20% reduced clamping force as a major comfort upgrade, but many pilots find it too loose, causing it to slip off easily.",
      "ANR performance: editorial reviews praise the digital ANR while owner forums argue it struggles when turning the head.",
      "Pricing discrepancies: used A20s range from $600 to $1,399 depending on the marketplace.",
      "Tap-control controversy: some pilots find the tap feature convenient while others report accidental triggers from cockpit bumps.",
      "Build quality dispute: plastic construction feels cheaper to some users than the magnesium-alloy A20.",
      "Outdated information: 2022 forum posts speculate about an A20 upgrade that became the A30.",
    ];
    const deduped = dedupeDisagreements(items);
    expect(deduped.length).toBeLessThanOrEqual(5);
    const clampCount = deduped.filter((d) => /clamping/i.test(d)).length;
    expect(clampCount).toBe(1);
  });

  it("keeps genuinely distinct items and drops empties", () => {
    expect(dedupeDisagreements(["", "  ", "Price conflict between retailers.", "Battery life claims differ across reviews."])).toEqual([
      "Price conflict between retailers.",
      "Battery life claims differ across reviews.",
    ]);
  });
});

// Regression (live prod report 2026-07-27): evidence delivered geni.us — an
// affiliate link shortener — as Amazon's retailer URL. Independence means no
// monetized links, ever.
// Regression (owner PDF 2026-07-28): grounded search only yields retailer
// homepages, so every listing landed on a generic front page.
describe("deepRetailerUrl", () => {
  it("rewrites known-retailer homepages to a product search", () => {
    expect(deepRetailerUrl("https://www.walmart.com", "Walmart", "Dyson V12 Detect Slim")).toBe(
      "https://www.walmart.com/search?q=Dyson%20V12%20Detect%20Slim",
    );
    expect(deepRetailerUrl("https://www.bestbuy.com/", "Best Buy", "Bose A30")).toBe(
      "https://www.bestbuy.com/site/searchpage.jsp?st=Bose%20A30",
    );
  });

  it("keeps evidence-provided product-page URLs untouched", () => {
    const deep = "https://www.walmart.com/ip/dyson-v12/5231447079";
    expect(deepRetailerUrl(deep, "Walmart", "Dyson V12")).toBe(deep);
  });

  it("maps a bare seller name to its search when no URL exists", () => {
    expect(deepRetailerUrl(null, "Amazon", "Dyson V12")).toBe(
      "https://www.amazon.com/s?k=Dyson%20V12",
    );
    expect(deepRetailerUrl(null, "Bob's Vacuums", "Dyson V12")).toBeNull();
  });

  it("unknown-domain homepages pass through unchanged", () => {
    expect(deepRetailerUrl("https://www.dyson.com", "Dyson", "Dyson V12")).toBe(
      "https://www.dyson.com",
    );
  });
});

describe("safeUrl independence", () => {
  it("drops affiliate shorteners outright", () => {
    expect(safeUrl("https://geni.us/Gx1nCkn")).toBeNull();
    expect(safeUrl("https://amzn.to/3xYz")).toBeNull();
    expect(safeUrl("https://www.shareasale.com/r.cfm?b=1")).toBeNull();
  });
  it("strips amazon affiliate tags but keeps the direct link", () => {
    expect(safeUrl("https://www.amazon.com/dp/B0ABC?tag=somebody-20&th=1")).toBe(
      "https://www.amazon.com/dp/B0ABC?th=1",
    );
  });
  it("keeps clean retailer links and rejects non-http", () => {
    expect(safeUrl("https://www.costco.com/dyson-v12.product.html")).toBe(
      "https://www.costco.com/dyson-v12.product.html",
    );
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });
});

/**
 * Regression (eval gate 2026-07-28, ce-sku-01): the sanitizer's gap detector was
 * looser than the downstream S5 check, so a vague model hedge ("a lack of expert
 * reviews limits a comprehensive assessment") suppressed the quantified sentence
 * and the reader never learned the evidence was 3 sources in 1 class. The
 * guarantee under test: whenever confidence is capped for thin evidence, the
 * reason names the shortfall in recognizable terms.
 */
describe("enforceSourceDiversity", () => {
  const verdict = (confidenceReason: string) =>
    ({ confidence: "high", confidenceReason } as unknown as Parameters<typeof enforceSourceDiversity>[0]);

  it("appends the quantified gap when the model only hedges vaguely", () => {
    const out = enforceSourceDiversity(
      verdict("Evidence strongly supports owner satisfaction. However, a lack of expert reviews limits a comprehensive market assessment."),
      3,
      ["retailer"] as never,
    );
    expect(out.confidence).toBe("medium");
    expect(out.confidenceReason).toContain("3 sources across 1 source class");
    expect(GAP_VOCABULARY.test(out.confidenceReason)).toBe(true);
  });

  it("leaves an already-explicit reason alone", () => {
    const reason = "Only 4 sources across 2 source classes were available, so this is not conclusive.";
    const out = enforceSourceDiversity(verdict(reason), 4, ["retailer", "review"] as never);
    expect(out.confidenceReason).toBe(reason);
  });

  it("does not touch a report with healthy diversity", () => {
    const out = enforceSourceDiversity(
      verdict("Broad agreement across independent testing outlets."),
      12,
      ["retailer", "review", "forum"] as never,
    );
    expect(out.confidence).toBe("high");
  });
});
