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
  it("returns the second opinion when the auditor answers", async () => {
    const call = vi.fn().mockResolvedValue({ agrees: false, note: "No source states night-mode volume." });
    const out = await auditReviewSummary(INPUT, { apiKey: "k", model: "kimi-k2.6", call });
    expect(out).toEqual({
      provider: "kimi",
      model: "kimi-k2.6",
      agrees: false,
      note: "No source states night-mode volume.",
    });
  });

  it("returns null — 'not checked' — when no second provider is configured", async () => {
    const call = vi.fn();
    expect(await auditReviewSummary(INPUT, { apiKey: null, model: "kimi-k2.6", call })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("never throws when the provider fails, so a report can still ship", async () => {
    const call = vi.fn().mockRejectedValue(new KimiError("quota", "out of balance", false));
    await expect(
      auditReviewSummary(INPUT, { apiKey: "k", model: "kimi-k2.6", call }),
    ).resolves.toBeNull();
  });

  it("survives an unexpected non-Kimi error too", async () => {
    const call = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      auditReviewSummary(INPUT, { apiKey: "k", model: "kimi-k2.6", call }),
    ).resolves.toBeNull();
  });

  it("skips the call when there is nothing to audit", async () => {
    const call = vi.fn();
    expect(
      await auditReviewSummary({ ...INPUT, reviewSummary: "  " }, { apiKey: "k", model: "m", call }),
    ).toBeNull();
    expect(
      await auditReviewSummary({ ...INPUT, evidenceNotes: "" }, { apiKey: "k", model: "m", call }),
    ).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
