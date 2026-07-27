import { describe, expect, it, vi } from "vitest";
import type {
  Assumption,
  PlanQuestion,
  ResearchControl,
  ResearchEvent,
} from "../../shared/report";
import {
  affirmedAssumptionTexts,
  applyControls,
  deriveHoursSaved,
  shouldStopDeepEvidence,
  type EvidenceState,
} from "./controls";
import { PROMPTS } from "./prompts";

/**
 * M2 live-session unit tests: control application, deep-mode sufficiency,
 * hoursSaved derivation, and the in-memory session store. No network — the
 * pipeline is mocked for session-store tests.
 */

vi.mock("./pipeline", () => ({
  runResearch: vi.fn(() => new Promise(() => undefined)),
}));

import { runResearch } from "./pipeline";
import { queueControl, startResearchSession, subscribeToSession, getSessionStatus } from "./session";

const question = (id: string, over: Partial<PlanQuestion> = {}): PlanQuestion => ({
  id,
  text: `Question ${id}`,
  status: "pending",
  whyItMatters: null,
  origin: "playbook",
  sourceCount: 0,
  ...over,
});

const assumption = (id: string, text: string, over: Partial<Assumption> = {}): Assumption => ({
  id,
  text,
  origin: "inferred",
  affirmed: true,
  ...over,
});

const baseState = (): EvidenceState => {
  const q1 = question("q1", { status: "done", sourceCount: 4 });
  const q2 = question("q2");
  const q3 = question("q3");
  return {
    plan: [q1, q2, q3],
    assumptions: [assumption("a1", "You want to stay under $400."), assumption("a2", "You cook for four.")],
    remaining: [[q2], [q3]],
  };
};

describe("applyControls", () => {
  it("remove-question of an un-run question drops it from remaining batches and marks it removed", () => {
    const control: ResearchControl = { type: "remove-question", controlId: "c1", questionId: "q2" };
    const { state, applied, planChanged } = applyControls(baseState(), [control]);
    expect(planChanged).toBe(true);
    expect(state.plan.find((q) => q.id === "q2")?.status).toBe("removed");
    expect(state.remaining.flat().map((q) => q.id)).toEqual(["q3"]);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.detail).toContain("no research was spent on it");
  });

  it("remove-question of a completed question keeps its evidence and says so", () => {
    const control: ResearchControl = { type: "remove-question", controlId: "c1", questionId: "q1" };
    const { state, applied } = applyControls(baseState(), [control]);
    expect(state.plan.find((q) => q.id === "q1")?.status).toBe("removed");
    // Remaining batches untouched — completed evidence is never discarded.
    expect(state.remaining.flat().map((q) => q.id)).toEqual(["q2", "q3"]);
    expect(applied[0]?.detail).toContain("evidence already gathered is kept");
  });

  it("add-question lands in the plan with origin user and joins the last remaining batch", () => {
    const control: ResearchControl = { type: "add-question", controlId: "c2", text: "Does the lid warp?" };
    const { state, applied, planChanged } = applyControls(baseState(), [control]);
    expect(planChanged).toBe(true);
    const added = state.plan.find((q) => q.origin === "user");
    expect(added).toBeDefined();
    expect(added?.text).toBe("Does the lid warp?");
    expect(added?.status).toBe("pending");
    expect(state.remaining[1]?.map((q) => q.id)).toContain(added?.id);
    expect(applied[0]?.detail).toContain("Added 'Does the lid warp?'");
  });

  it("add-question opens a new batch when evidence already finished", () => {
    const state: EvidenceState = { ...baseState(), remaining: [] };
    const control: ResearchControl = { type: "add-question", controlId: "c2", text: "Is it oven safe?" };
    const outcome = applyControls(state, [control]);
    expect(outcome.state.remaining).toHaveLength(1);
    expect(outcome.state.remaining[0]?.[0]?.origin).toBe("user");
  });

  it("set-assumption edits change the text and subsequent prompt args", () => {
    const control: ResearchControl = {
      type: "set-assumption",
      controlId: "c3",
      assumptionId: "a1",
      affirmed: true,
      text: "You want to stay under $250.",
    };
    const { state, assumptionsChanged } = applyControls(baseState(), [control]);
    expect(assumptionsChanged).toBe(true);
    const edited = state.assumptions.find((a) => a.id === "a1");
    expect(edited?.text).toBe("You want to stay under $250.");
    expect(edited?.origin).toBe("user");
    // The edited assumption is what every subsequent prompt build receives.
    const texts = affirmedAssumptionTexts(state.assumptions);
    expect(texts).toContain("You want to stay under $250.");
    const prompt = PROMPTS.evidence.build({
      query: "dutch oven",
      categoryLabel: "Home goods",
      criteria: ["durability"],
      assumptions: texts,
      questions: [{ id: "q3", text: "Question q3" }],
    });
    expect(prompt).toContain("You want to stay under $250.");
    expect(prompt).not.toContain("under $400");
  });

  it("dismissed assumptions are excluded from prompt args but kept in state", () => {
    const control: ResearchControl = {
      type: "set-assumption",
      controlId: "c4",
      assumptionId: "a2",
      affirmed: false,
    };
    const { state, applied } = applyControls(baseState(), [control]);
    expect(state.assumptions).toHaveLength(2);
    expect(affirmedAssumptionTexts(state.assumptions)).toEqual(["You want to stay under $400."]);
    expect(applied[0]?.detail).toContain("Dismissed");
  });

  it("add-assumption appends a user assumption honored by later prompts", () => {
    const control: ResearchControl = { type: "add-assumption", controlId: "c5", text: "You have a gas stove." };
    const { state } = applyControls(baseState(), [control]);
    const added = state.assumptions.find((a) => a.origin === "user");
    expect(added?.affirmed).toBe(true);
    expect(affirmedAssumptionTexts(state.assumptions)).toContain("You have a gas stove.");
  });

  it("skips controls with unknown ids without failing the batch", () => {
    const controls: ResearchControl[] = [
      { type: "remove-question", controlId: "c6", questionId: "nope" },
      { type: "set-assumption", controlId: "c7", assumptionId: "nope", affirmed: false },
    ];
    const outcome = applyControls(baseState(), controls);
    expect(outcome.applied).toHaveLength(0);
    expect(outcome.planChanged).toBe(false);
    expect(outcome.assumptionsChanged).toBe(false);
  });

  it("never mutates the input state", () => {
    const state = baseState();
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    applyControls(state, [
      { type: "remove-question", controlId: "c8", questionId: "q2" },
      { type: "add-question", controlId: "c9", text: "Extra question?" },
      { type: "add-assumption", controlId: "c10", text: "Extra assumption." },
    ]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
  });
});

describe("shouldStopDeepEvidence", () => {
  it("never stops before batch 3", () => {
    expect(shouldStopDeepEvidence(1, 0)).toBe(false);
    expect(shouldStopDeepEvidence(2, 0)).toBe(false);
  });

  it("stops after batch 3 only when the newest batch added fewer than 3 new sources", () => {
    expect(shouldStopDeepEvidence(3, 2)).toBe(true);
    expect(shouldStopDeepEvidence(3, 3)).toBe(false);
    expect(shouldStopDeepEvidence(4, 0)).toBe(true);
    expect(shouldStopDeepEvidence(4, 5)).toBe(false);
  });
});

describe("deriveHoursSaved", () => {
  it("returns null when no questions were answered — never a fabricated estimate", () => {
    expect(deriveHoursSaved(0, 12)).toBeNull();
  });

  it("derives min/max from answered questions with an honest basis string", () => {
    const estimate = deriveHoursSaved(5, 31);
    expect(estimate).not.toBeNull();
    expect(estimate?.min).toBe(2);
    expect(estimate?.max).toBe(4);
    expect(estimate?.basis).toBe(
      "Estimated from 5 research questions across 31 sources you'd otherwise read by hand.",
    );
  });

  it("clamps small and large runs sensibly and keeps min <= max", () => {
    const tiny = deriveHoursSaved(1, 1);
    expect(tiny?.min).toBeGreaterThanOrEqual(0.2);
    expect(tiny?.basis).toContain("1 research question across 1 source");
    const huge = deriveHoursSaved(40, 200);
    expect(huge?.min).toBeLessThanOrEqual(6);
    expect(huge?.max).toBeLessThanOrEqual(10);
    expect(huge !== null && huge.min <= huge.max).toBe(true);
  });
});

describe("session store", () => {
  type PipelineArgs = {
    emit: (event: ResearchEvent) => void;
    drainControls: () => ResearchControl[];
    researchId: string;
  };
  const lastPipelineArgs = (): PipelineArgs => {
    const calls = vi.mocked(runResearch).mock.calls;
    const last = calls[calls.length - 1]?.[0] as PipelineArgs | undefined;
    if (last === undefined) throw new Error("runResearch was not called");
    return last;
  };
  const stageEvent = (stage: string): ResearchEvent => ({
    type: "stage",
    stage,
    status: "started",
    elapsedMs: 1,
  });
  const errorEvent = (): ResearchEvent => ({
    type: "error",
    error: { ok: false, code: "research-failed", message: "failed", retryable: true },
  });

  it("starts the pipeline with the session's researchId and drains queued controls", () => {
    const id = startResearchSession({ query: "dutch oven", mode: "quick" });
    const args = lastPipelineArgs();
    expect(args.researchId).toBe(id);
    expect(getSessionStatus(id)).toBe("running");

    const control: ResearchControl = { type: "add-question", controlId: "c1", text: "Oven safe?" };
    expect(queueControl(id, control)).toBe("queued");
    expect(args.drainControls()).toEqual([control]);
    expect(args.drainControls()).toEqual([]); // drained exactly once
  });

  it("replays all logged events on subscribe, then delivers live events in order", () => {
    const id = startResearchSession({ query: "dutch oven", mode: "quick" });
    const args = lastPipelineArgs();
    args.emit(stageEvent("classify"));
    args.emit(stageEvent("plan"));

    const seen: ResearchEvent[] = [];
    const sub = subscribeToSession(id, (e) => seen.push(e));
    expect(sub?.replay.map((e) => (e.type === "stage" ? e.stage : e.type))).toEqual([
      "classify",
      "plan",
    ]);
    args.emit(stageEvent("evidence-1"));
    expect(seen).toHaveLength(1);
    sub?.unsubscribe();
    args.emit(stageEvent("evidence-2"));
    expect(seen).toHaveLength(1);
  });

  it("rejects controls for unknown and terminal sessions", () => {
    const control: ResearchControl = { type: "add-question", controlId: "c2", text: "Oven safe?" };
    expect(queueControl("does-not-exist", control)).toBe("not-found");

    const id = startResearchSession({ query: "dutch oven", mode: "quick" });
    lastPipelineArgs().emit(errorEvent());
    expect(getSessionStatus(id)).toBe("failed");
    expect(queueControl(id, control)).toBe("terminal");
  });

  it("returns null when subscribing to an unknown session", () => {
    expect(subscribeToSession("does-not-exist", () => undefined)).toBeNull();
  });
});
