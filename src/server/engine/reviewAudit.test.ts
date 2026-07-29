import { describe, expect, it, vi } from "vitest";
import { KimiError } from "../kimi";
import {
  auditReviewSummary,
  buildReviewAuditPrompt,
  parseReviewAudit,
  type ReviewAuditInput,
} from "./reviewAudit";

const INPUT: ReviewAuditInput = {
  productName: "Levoit Core 300S",
  reviewSummary: "Owners consistently praise the quiet night mode.",
  ratingValue: 4.5,
  evidenceNotes: "Reviewers at rtings noted a 24 dB low setting; several owners mention quiet operation.",
};

describe("buildReviewAuditPrompt", () => {
  it("puts the claim under audit and its evidence in front of the auditor", () => {
    const prompt = buildReviewAuditPrompt(INPUT);
    expect(prompt).toContain("Levoit Core 300S");
    expect(prompt).toContain("Owners consistently praise the quiet night mode.");
    expect(prompt).toContain("24 dB");
    expect(prompt).toContain("4.5 out of 5");
  });

  it("says plainly when no rating was reported rather than implying zero", () => {
    const prompt = buildReviewAuditPrompt({ ...INPUT, ratingValue: null });
    expect(prompt).toContain("no numeric rating was reported");
    expect(prompt).not.toContain("0 out of 5");
  });

  it("instructs that thin evidence counts as disagreement", () => {
    // Overstated confidence is the failure mode this audit exists to catch.
    expect(buildReviewAuditPrompt(INPUT)).toContain("too thin");
  });

  it("bounds the evidence so a long run cannot blow the context window", () => {
    const huge = { ...INPUT, evidenceNotes: "x".repeat(20_000) };
    expect(buildReviewAuditPrompt(huge).length).toBeLessThan(8_000);
  });
});

describe("parseReviewAudit", () => {
  it("accepts a clean JSON reply", () => {
    expect(parseReviewAudit('{"agrees":true,"note":"Evidence backs the quiet claim."}')).toEqual({
      agrees: true,
      note: "Evidence backs the quiet claim.",
    });
  });

  it("tolerates markdown fences a chat model adds despite instructions", () => {
    const out = parseReviewAudit('```json\n{"agrees":false,"note":"No source states this."}\n```');
    expect(out.agrees).toBe(false);
  });

  it("tolerates prose wrapped around the object", () => {
    const out = parseReviewAudit('Sure! {"agrees":true,"note":"Confirmed by two sources."} Hope that helps.');
    expect(out.note).toBe("Confirmed by two sources.");
  });

  it("rejects a reply with no JSON at all", () => {
    expect(() => parseReviewAudit("I cannot help with that.")).toThrow(KimiError);
  });

  it("rejects a reply that omits the verdict", () => {
    expect(() => parseReviewAudit('{"note":"looks fine"}')).toThrow(KimiError);
  });

  it("rejects an over-long note rather than letting it run in the UI", () => {
    expect(() => parseReviewAudit(`{"agrees":true,"note":"${"w".repeat(400)}"}`)).toThrow(KimiError);
  });
});

describe("auditReviewSummary", () => {
  const USAGE = { inputTokens: 258, outputTokens: 1200 };

  it("returns the second opinion and what it cost when the auditor answers", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ data: { agrees: false, note: "No source states night-mode volume." }, usage: USAGE });
    const out = await auditReviewSummary(INPUT, { provider: "kimi" as const, apiKey: "k", model: "kimi-k2.6", call });
    expect(out.opinion).toEqual({
      provider: "kimi",
      model: "kimi-k2.6",
      agrees: false,
      note: "No source states night-mode volume.",
    });
    expect(out.usage).toEqual(USAGE);
  });

  it("returns 'not checked' with no spend when no second provider is configured", async () => {
    const call = vi.fn();
    const out = await auditReviewSummary(INPUT, { provider: "kimi" as const, apiKey: null, model: "kimi-k2.6", call });
    expect(out.opinion).toBeNull();
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(call).not.toHaveBeenCalled();
  });

  it("never throws when the provider fails, so a report can still ship", async () => {
    const call = vi.fn().mockRejectedValue(new KimiError("quota", "out of balance", false));
    const out = await auditReviewSummary(INPUT, { provider: "kimi" as const, apiKey: "k", model: "kimi-k2.6", call });
    expect(out.opinion).toBeNull();
  });

  it("survives an unexpected non-Kimi error too", async () => {
    const call = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await auditReviewSummary(INPUT, { provider: "kimi" as const, apiKey: "k", model: "kimi-k2.6", call });
    expect(out.opinion).toBeNull();
  });

  it("skips the call when there is nothing to audit", async () => {
    const call = vi.fn();
    expect(
      (await auditReviewSummary({ ...INPUT, reviewSummary: "  " }, { provider: "kimi" as const, apiKey: "k", model: "m", call })).opinion,
    ).toBeNull();
    expect(
      (await auditReviewSummary({ ...INPUT, evidenceNotes: "" }, { provider: "kimi" as const, apiKey: "k", model: "m", call })).opinion,
    ).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});

describe("auditor independence", () => {
  it("labels the opinion with the provider that actually audited", async () => {
    // The whole mechanism is worthless if the auditor is the author, so the
    // recorded provider must be the auditing one, not a hardcoded name.
    const call = vi.fn().mockResolvedValue({
      data: { agrees: true, note: "Two cited pages state this." },
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    const out = await auditReviewSummary(INPUT, {
      provider: "gemini",
      apiKey: "k",
      model: "gemini-2.5-flash-lite",
      call,
    });
    expect(out.opinion?.provider).toBe("gemini");
    expect(out.opinion?.model).toBe("gemini-2.5-flash-lite");
  });
});
