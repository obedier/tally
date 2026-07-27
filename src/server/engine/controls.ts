import type {
  Assumption,
  HoursSaved,
  PlanQuestion,
  ResearchControl,
} from "../../shared/report";

/**
 * Pure mid-run steering logic per docs/ENGINE.md: completed evidence is NEVER
 * discarded; user controls steer only the remaining work. The pipeline applies
 * pending controls at stage boundaries and between evidence batches.
 * Everything here is pure and unit-tested without network.
 */

const SNIPPET_MAX = 60;

/** Short human-readable fragment of a question/assumption for control-applied copy. */
const snippet = (text: string): string => {
  const t = text.trim();
  return t.length <= SNIPPET_MAX ? t : `${t.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;
};

export type EvidenceState = {
  readonly plan: readonly PlanQuestion[];
  readonly assumptions: readonly Assumption[];
  /** Un-run evidence batches, in run order. Completed batches are not represented here. */
  readonly remaining: readonly (readonly PlanQuestion[])[];
};

export type AppliedControl = {
  readonly controlId: string;
  readonly kind: ResearchControl["type"];
  /** Human sentence for the `control-applied` event — honest about what happened. */
  readonly detail: string;
};

export type ControlOutcome = {
  readonly state: EvidenceState;
  readonly applied: readonly AppliedControl[];
  readonly planChanged: boolean;
  readonly assumptionsChanged: boolean;
};

type StepResult = {
  readonly state: EvidenceState;
  readonly applied: AppliedControl | null;
  readonly planChanged: boolean;
  readonly assumptionsChanged: boolean;
};

const unchanged = (state: EvidenceState): StepResult => ({
  state,
  applied: null,
  planChanged: false,
  assumptionsChanged: false,
});

function applyRemoveQuestion(
  state: EvidenceState,
  control: Extract<ResearchControl, { type: "remove-question" }>,
): StepResult {
  const target = state.plan.find((q) => q.id === control.questionId);
  if (target === undefined || target.status === "removed") return unchanged(state);
  const plan = state.plan.map((q) =>
    q.id === control.questionId ? { ...q, status: "removed" as const } : q,
  );
  // Drop it from every un-run batch so no research is ever spent on it.
  const remaining = state.remaining
    .map((group) => group.filter((q) => q.id !== control.questionId))
    .filter((group) => group.length > 0);
  const detail =
    target.status === "done"
      ? `Removed '${snippet(target.text)}' — evidence already gathered is kept, but no further research will build on it.`
      : `Removed '${snippet(target.text)}' from the plan — no research was spent on it.`;
  return {
    state: { ...state, plan, remaining },
    applied: { controlId: control.controlId, kind: control.type, detail },
    planChanged: true,
    assumptionsChanged: false,
  };
}

function applyAddQuestion(
  state: EvidenceState,
  control: Extract<ResearchControl, { type: "add-question" }>,
): StepResult {
  const text = control.text.trim();
  if (text === "") return unchanged(state);
  const n = state.plan.filter((q) => q.id.startsWith("user-q")).length + 1;
  const question: PlanQuestion = {
    id: `user-q${n}`,
    text,
    status: "pending",
    whyItMatters: null,
    origin: "user",
    sourceCount: 0,
  };
  const plan = [...state.plan, question];
  // Schedule into the last un-run batch; if evidence already ran out, open a
  // new batch (the pipeline runs one small extra grounded batch for these).
  const remaining =
    state.remaining.length === 0
      ? [[question]]
      : state.remaining.map((group, i) =>
          i === state.remaining.length - 1 ? [...group, question] : group,
        );
  return {
    state: { ...state, plan, remaining },
    applied: {
      controlId: control.controlId,
      kind: control.type,
      detail: `Added '${snippet(text)}' to the research plan — it will be covered by the remaining research.`,
    },
    planChanged: true,
    assumptionsChanged: false,
  };
}

function applySetAssumption(
  state: EvidenceState,
  control: Extract<ResearchControl, { type: "set-assumption" }>,
): StepResult {
  const target = state.assumptions.find((a) => a.id === control.assumptionId);
  if (target === undefined) return unchanged(state);
  const newText = control.text?.trim();
  const hasNewText = newText !== undefined && newText !== "";
  const updated: Assumption = {
    ...target,
    affirmed: control.affirmed,
    ...(hasNewText ? { text: newText, origin: "user" as const } : {}),
  };
  const assumptions = state.assumptions.map((a) => (a.id === control.assumptionId ? updated : a));
  const detail = !control.affirmed
    ? `Dismissed the assumption '${snippet(updated.text)}' — remaining research won't rely on it.`
    : hasNewText
      ? `Updated the assumption to '${snippet(updated.text)}' — remaining research will honor it.`
      : `Confirmed the assumption '${snippet(updated.text)}'.`;
  return {
    state: { ...state, assumptions },
    applied: { controlId: control.controlId, kind: control.type, detail },
    planChanged: false,
    assumptionsChanged: true,
  };
}

function applyAddAssumption(
  state: EvidenceState,
  control: Extract<ResearchControl, { type: "add-assumption" }>,
): StepResult {
  const text = control.text.trim();
  if (text === "") return unchanged(state);
  const n = state.assumptions.filter((a) => a.id.startsWith("user-a")).length + 1;
  const assumption: Assumption = { id: `user-a${n}`, text, origin: "user", affirmed: true };
  return {
    state: { ...state, assumptions: [...state.assumptions, assumption] },
    applied: {
      controlId: control.controlId,
      kind: control.type,
      detail: `Added your assumption '${snippet(text)}' — remaining research will honor it.`,
    },
    planChanged: false,
    assumptionsChanged: true,
  };
}

function applyOne(state: EvidenceState, control: ResearchControl): StepResult {
  switch (control.type) {
    case "remove-question":
      return applyRemoveQuestion(state, control);
    case "add-question":
      return applyAddQuestion(state, control);
    case "set-assumption":
      return applySetAssumption(state, control);
    case "add-assumption":
      return applyAddAssumption(state, control);
  }
}

/**
 * Applies controls in order, returning a new state (never mutating the input).
 * Controls referencing unknown ids are skipped silently (no applied entry) —
 * they were validated at the API seam; a stale id just means the run moved on.
 */
export function applyControls(
  state: EvidenceState,
  controls: readonly ResearchControl[],
): ControlOutcome {
  let current = state;
  let planChanged = false;
  let assumptionsChanged = false;
  const applied: AppliedControl[] = [];
  for (const control of controls) {
    const step = applyOne(current, control);
    current = step.state;
    planChanged = planChanged || step.planChanged;
    assumptionsChanged = assumptionsChanged || step.assumptionsChanged;
    if (step.applied !== null) applied.push(step.applied);
  }
  return { state: current, applied, planChanged, assumptionsChanged };
}

/** Prompt builds only ever see currently-affirmed assumptions. */
export const affirmedAssumptionTexts = (assumptions: readonly Assumption[]): string[] =>
  assumptions.filter((a) => a.affirmed).map((a) => a.text);

/** Deep-mode evidence sufficiency: after batch 3, a batch adding <3 new unique sources ends the loop. */
export const DEEP_SUFFICIENCY_MIN_BATCHES = 3;
export const DEEP_SUFFICIENCY_MIN_NEW_SOURCES = 3;

export function shouldStopDeepEvidence(
  completedBatches: number,
  newestBatchNewSources: number,
): boolean {
  return (
    completedBatches >= DEEP_SUFFICIENCY_MIN_BATCHES &&
    newestBatchNewSources < DEEP_SUFFICIENCY_MIN_NEW_SOURCES
  );
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const HOURS_MIN_PER_QUESTION = 0.4;
const HOURS_MAX_PER_QUESTION = 0.8;
const HOURS_MIN_FLOOR = 0.2;
const HOURS_MIN_CAP = 6;
const HOURS_MAX_CAP = 10;

/**
 * Honest time-saved estimate derived only from real observables (answered
 * questions, sources consulted). The basis string states that it is an
 * estimate — it is never presented as a measured fact.
 */
export function deriveHoursSaved(
  answeredQuestions: number,
  sourceCount: number,
): HoursSaved | null {
  if (answeredQuestions <= 0) return null;
  const min = Math.min(
    HOURS_MIN_CAP,
    Math.max(HOURS_MIN_FLOOR, round1(HOURS_MIN_PER_QUESTION * answeredQuestions)),
  );
  const max = Math.max(min, Math.min(HOURS_MAX_CAP, round1(HOURS_MAX_PER_QUESTION * answeredQuestions)));
  const questionsText = `${answeredQuestions} research question${answeredQuestions === 1 ? "" : "s"}`;
  const sourcesText = `${sourceCount} source${sourceCount === 1 ? "" : "s"}`;
  return {
    min,
    max,
    basis: `Estimated from ${questionsText} across ${sourcesText} you'd otherwise read by hand.`,
  };
}
