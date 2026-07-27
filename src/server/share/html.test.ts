import { describe, expect, it } from "vitest";
import { ReportSchema, type Report } from "../../shared/report";
import { buildShareHtml, esc } from "./html";

/**
 * Fixture builder: a minimal report that VALIDATES against the real contract,
 * so these tests exercise the same shape the server persists. `overrides` lets
 * individual tests inject hostile strings (e.g. an XSS payload in `query`).
 */
function makeReport(overrides: Partial<Report> = {}): Report {
  const base: Report = {
    id: "rep_test123",
    query: "best noise-cancelling headphones for flights",
    hoursSaved: null,
    queryType: "need",
    category: { id: "consumer-electronics", label: "Consumer electronics", confidence: 0.9 },
    createdAt: "2026-07-20T14:00:00.000Z",
    assumptions: [],
    questions: [],
    verdict: {
      headline: "Get the Sony WH-1000XM5 — best all-round for flights",
      rationale: "It leads on noise cancellation and comfort for long-haul use.",
      confidence: "high",
      confidenceReason: "Four independent source classes agree on the ranking.",
      decisiveFactors: ["Best-in-class active noise cancellation", "All-day comfort"],
    },
    bestFit: {
      name: "Sony WH-1000XM5",
      priceRange: { min: 328, max: 399, currency: "USD", display: "$328–$399" },
      rating: { value: 4.5, outOf: 5, summary: "Owners praise ANC and comfort." },
      pros: ["Class-leading ANC", "Comfortable for long flights"],
      cons: ["Not foldable", "Case is bulky"],
      whyBest: "Best noise cancellation and comfort for frequent flyers.",
      sourceIds: ["s1"],
    },
    alternatives: [
      {
        rank: 2,
        name: "Bose QuietComfort Ultra",
        priceRange: { min: 379, max: 429, currency: "USD", display: "$379–$429" },
        ratingValue: 4.4,
        note: "Pick this if you want the most natural spatial audio.",
        pros: ["Great spatial audio"],
        cons: ["Pricier"],
        reviewSummary: "Reviewers like the immersive mode.",
        isKeyAlternative: true,
      },
    ],
    retailers: [],
    location: null,
    sources: [
      {
        id: "s1",
        title: "RTINGS headphone review",
        url: "https://www.rtings.com/headphones/reviews/sony/wh-1000xm5",
        domain: "rtings.com",
        sourceClass: "editorial",
      },
    ],
    meta: {
      engineVersion: "1.0.0",
      playbookId: "consumer-electronics",
      playbookVersion: "1.0.0",
      promptVersions: { classify: "v1" },
      model: "gemini",
      mode: "full",
      stageTimings: [],
      totalMs: 12000,
      disagreements: [],
      sourceDiversity: { count: 4, classesRepresented: ["editorial", "retailer"] },
    },
  };
  return ReportSchema.parse({ ...base, ...overrides });
}

const ORIGIN = "https://tally.app";

describe("buildShareHtml", () => {
  it("renders the required OG/social meta tags", () => {
    const html = buildShareHtml(makeReport(), ORIGIN);
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('content="https://tally.app/og/rep_test123.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('<link rel="canonical" href="https://tally.app/s/rep_test123"');
  });

  it("renders the verdict headline, best fit, and required strings", () => {
    const html = buildShareHtml(makeReport(), ORIGIN);
    expect(html).toContain("Get the Sony WH-1000XM5 — best all-round for flights");
    expect(html).toContain("Sony WH-1000XM5");
    expect(html).toContain("$328–$399");
    // Exact required strings, verbatim from docs/GROWTH.md.
    expect(html).toContain("Researched by Tally");
    expect(html).toContain("Research your own — free");
    expect(html).toContain("prices may have changed — re-run this research");
  });

  it("shows the visible research date and a re-run link to the SPA", () => {
    const html = buildShareHtml(makeReport(), ORIGIN);
    expect(html).toContain("July 20, 2026");
    expect(html).toContain(
      '/research?q=best+noise-cancelling+headphones+for+flights&amp;mode=full',
    );
    expect(html).toContain("entry=share-cta");
  });

  it("ESCAPES report-derived strings — no raw <script> from a hostile query", () => {
    const html = buildShareHtml(
      makeReport({ query: "x<script>alert(1)</script>" }),
      ORIGIN,
    );
    // The dangerous raw tag must NOT appear...
    expect(html).not.toContain("<script>alert(1)</script>");
    // ...but its escaped form must be present, proving the value was rendered safely.
    expect(html).toContain("x&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes a hostile product name in the body", () => {
    const report = makeReport();
    const hostile = ReportSchema.parse({
      ...report,
      bestFit: { ...report.bestFit, name: '"><img src=x onerror=alert(1)>' },
    });
    const html = buildShareHtml(hostile, ORIGIN);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("esc", () => {
  it("escapes all HTML-significant characters", () => {
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
