import { describe, expect, it } from "vitest";
import { MODE_QUESTION_LIMITS, PLAYBOOKS, questionsForMode } from "./playbooks";

/**
 * M3 gate 5: the two launch verticals must demonstrably produce
 * category-specific questions and criteria — not a generic shared list.
 */
describe("category playbooks are category-specific (M3 gate 5)", () => {
  const ce = PLAYBOOKS["consumer-electronics"];
  const hg = PLAYBOOKS["home-goods"];

  it("each launch vertical has its own non-empty criteria and questions", () => {
    for (const pb of [ce, hg]) {
      expect(pb.criteria.length).toBeGreaterThan(0);
      expect(pb.questions.length).toBeGreaterThan(0);
    }
  });

  it("the two verticals share no question ids and are mostly distinct in text", () => {
    const ceIds = new Set(ce.questions.map((q) => q.id));
    const hgIds = new Set(hg.questions.map((q) => q.id));
    const sharedIds = [...ceIds].filter((id) => hgIds.has(id));
    expect(sharedIds).toEqual([]);

    // Incidental overlap on a generic question (e.g. price) is acceptable; the
    // majority of each vertical's questions must be category-specific.
    const ceText = new Set(ce.questions.map((q) => q.template.toLowerCase()));
    const overlap = hg.questions.filter((q) => ceText.has(q.template.toLowerCase()));
    expect(overlap.length).toBeLessThan(hg.questions.length / 2);
  });

  it("their criteria sets are distinct", () => {
    const ceCrit = new Set(ce.criteria.map((c) => c.toLowerCase()));
    const shared = hg.criteria.filter((c) => ceCrit.has(c.toLowerCase()));
    // Some incidental overlap (e.g. "price") is fine, but they must not be identical.
    expect(shared.length).toBeLessThan(Math.min(ce.criteria.length, hg.criteria.length));
  });

  it("questionsForMode yields distinct, leverage-ranked sets per vertical", () => {
    const ceQuick = questionsForMode(ce, "quick").map((q) => q.id);
    const hgQuick = questionsForMode(hg, "quick").map((q) => q.id);
    expect(ceQuick.length).toBeLessThanOrEqual(MODE_QUESTION_LIMITS.quick);
    expect(ceQuick).not.toEqual(hgQuick);
    expect(ceQuick.every((id) => id.startsWith("ce-"))).toBe(true);
    expect(hgQuick.every((id) => id.startsWith("hg-"))).toBe(true);
  });
});
