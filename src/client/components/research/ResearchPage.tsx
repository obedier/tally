import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ResearchModeSchema,
  type HoursSaved,
  type Report,
  type ResearchMode,
  type SeedAssumption,
} from "../../../shared/report";

/** Shape of a single assumption edit carried in router nav state from a report. */
interface AssumptionEditNav {
  id: string;
  text: string;
  affirmed: boolean;
}
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop } from "../ui/States";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { PlanEditor } from "./PlanEditor";
import { useResearchSession } from "./useResearchSession";
import "./research.css";

const MODE_LABELS: Record<ResearchMode, string> = {
  quick: "Quick research",
  full: "Full research",
  deep: "Deep dive",
};

/** Ambient object imagery shown while research streams — decor, never results. */
const AMBIENT_IMAGES = [
  "/product-images/catalog-vacuum.png",
  "/product-images/dutch-oven.png",
  "/product-images/linen-bedding.png",
];

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function humanizeStage(stage: string): string {
  const words = stage.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Live research over a session: POST once, stream (and replay on reload) over
 * SSE, steer mid-run. Real events only — no fake percentages, no invented
 * products, no unlabeled estimates.
 */
export function ResearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const query = (params.get("q") ?? "").trim();
  const rid = params.get("rid");
  const locationParam = params.get("location")?.trim() || undefined;
  const modeParse = ResearchModeSchema.safeParse(params.get("mode"));
  // Unknown/tampered mode falls back to the CHEAPEST tier, never the most expensive.
  const mode: ResearchMode = modeParse.success ? modeParse.data : "quick";
  const [attempt, setAttempt] = useState(0);

  // Assumption edits carried from a report's "re-run with my changes" arrive in
  // router nav state (lost on hard reload, which is fine: they're only needed at
  // POST time, before any reconnect). Seeded by text — the new session re-ids.
  const navState = location.state as { assumptionEdits?: AssumptionEditNav[] } | null;
  const seedAssumptions: SeedAssumption[] = (navState?.assumptionEdits ?? [])
    .map((edit) => ({ text: edit.text.trim(), affirmed: edit.affirmed }))
    .filter((edit) => edit.text !== "");

  // Completion beat: hold the finished state for a moment (progress full, "verdict
  // ready") before opening the report — a real pause, never a fake delay mid-run.
  const beatTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (beatTimerRef.current !== null) window.clearTimeout(beatTimerRef.current);
    },
    [],
  );
  const onReport = useCallback(
    (report: Report) => {
      track({ name: "report_viewed", reportId: report.id, surface: "research" });
      beatTimerRef.current = window.setTimeout(() => {
        beatTimerRef.current = null;
        void navigate(`/report/${report.id}`, { replace: true, state: { report } });
      }, 1200);
    },
    [navigate],
  );

  // Once the session exists the URL becomes ?rid= (keeping q for honest retry
  // after server GC) so a mid-research reload reconnects and replays seamlessly.
  const onResearchId = useCallback(
    (researchId: string) => {
      const next = new URLSearchParams({ rid: researchId });
      if (query) next.set("q", query);
      next.set("mode", mode);
      navigate(`/research?${next.toString()}`, { replace: true });
    },
    [navigate, query, mode],
  );

  const { state, sendControl, dismissControlNote } = useResearchSession({
    locationKey: location.key,
    query,
    mode,
    rid,
    attempt,
    location: locationParam,
    seedAssumptions,
    onReport,
    onResearchId,
  });

  if (!query && rid === null) {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        <ErrorState
          title="There's nothing to research yet."
          detail="Head home and tell Tally what you're deciding on — a product, a need, a problem, or a SKU."
        />
      </main>
    );
  }

  if (state.phase === "missing") {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        {query ? <h1 className="display display--headline research__query">{query}</h1> : null}
        <ErrorState
          title="This live session has ended."
          detail={
            query
              ? "This live session has ended. Run it again — Tally redoes the work fresh, never stale."
              : "This live session has ended. Head home to start fresh."
          }
          onRetry={
            query
              ? () =>
                  navigate(`/research?${new URLSearchParams({ q: query, mode }).toString()}`)
              : undefined
          }
          retryLabel="Research this again"
        />
      </main>
    );
  }

  if (state.phase === "failed") {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        <p className="kicker">{MODE_LABELS[mode]}</p>
        {query ? <h1 className="display display--headline research__query">{query}</h1> : null}
        <ErrorState
          title="The research didn't finish."
          detail={
            state.error
              ? state.error.message
              : "The connection dropped before a verdict was ready — nothing unverified is shown. Reconnect to pick up where it left off."
          }
          onRetry={() => setAttempt((n) => n + 1)}
          retryLabel={rid !== null && !state.error ? "Reconnect" : "Retry research"}
        />
      </main>
    );
  }

  const canSteer = state.phase === "connecting" || state.phase === "streaming";
  const isLive = canSteer || state.phase === "starting";
  const visibleQuestions = state.questions.filter((question) => question.status !== "removed");
  const doneCount = visibleQuestions.filter((question) => question.status === "done").length;

  // Honest progress: driven by real question completion (never a fake %). Early
  // phases show a small indeterminate amount; synthesize holds near the end.
  const progress =
    state.phase === "done"
      ? 1
      : state.stage?.stage === "synthesize"
        ? 0.92
        : visibleQuestions.length > 0
          ? Math.min(0.9, 0.12 + 0.78 * (doneCount / visibleQuestions.length))
          : state.stage
            ? 0.1
            : 0.04;
  // Rough remaining-time estimate derived from real elapsed vs progress — always
  // labeled an estimate, only shown once there's enough signal to be meaningful.
  const etaSeconds =
    progress > 0.12 && progress < 1 && state.elapsedSeconds > 4
      ? Math.round((state.elapsedSeconds * (1 - progress)) / progress)
      : null;

  // Cancel = stop watching and go home; the abandonment beacon fires on unmount.
  const cancelResearch = (): void => {
    void navigate("/", { replace: true });
  };

  return (
    <main className="page research">
      <PageTop back={{ to: "/", label: "Home" }} />

      <header className="research__head">
        <p className="kicker">{MODE_LABELS[mode]}</p>
        <h1 className="display display--headline research__query">
          {query || "Live research"}
        </h1>
        <p className="small-copy research__meter" aria-live="polite">
          <span className="research__pulse" aria-hidden="true" />
          {state.phase === "starting" ? "Starting the research session…" : null}
          {state.phase === "connecting" ? "Opening live research…" : null}
          {state.phase === "streaming" && state.stage
            ? `${humanizeStage(state.stage.stage)}${state.stage.detail ? ` — ${state.stage.detail}` : ""}`
            : null}
          {state.phase === "streaming" && !state.stage ? "Researching…" : null}
          {state.phase === "done" ? "Research complete." : null}
          <span className="research__elapsed">{formatElapsed(state.elapsedSeconds)} elapsed</span>
        </p>
        <p className="micro-copy research__counts">
          {visibleQuestions.length > 0
            ? `${doneCount} of ${visibleQuestions.length} questions answered · `
            : ""}
          {state.sourceCount > 0
            ? `${state.sourceCount} sources consulted so far`
            : "Gathering sources…"}
        </p>

        {isLive || state.phase === "done" ? (
          <div className="research__progress">
            <div
              className="research__progress-track"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Research progress"
            >
              <span className="research__progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="research__progress-meta">
              <span className="micro-copy">
                {state.phase === "done"
                  ? "Verdict ready — opening your report…"
                  : etaSeconds !== null
                    ? `~${formatElapsed(etaSeconds)} left · estimate`
                    : "Estimating…"}
              </span>
              {isLive ? (
                <button type="button" className="research__cancel" onClick={cancelResearch}>
                  Stop research
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {state.hoursSaved ? <TimeSavedChip estimate={state.hoursSaved} /> : null}
      </header>

      {isLive ? (
        <div className="research__ambient" aria-hidden="true">
          {AMBIENT_IMAGES.map((src) => (
            <img key={src} src={src} alt="" width={88} height={88} loading="lazy" />
          ))}
        </div>
      ) : null}

      {state.controlNote ? (
        <p className="research__note" role="alert">
          <span>{state.controlNote}</span>
          <button type="button" className="research__mini-button" onClick={dismissControlNote}>
            Dismiss
          </button>
        </p>
      ) : null}

      <AssumptionsPanel
        assumptions={state.assumptions}
        researchId={state.researchId}
        canSteer={canSteer}
        sendControl={sendControl}
      />

      <PlanEditor
        questions={state.questions}
        suggestions={state.suggestions}
        researchId={state.researchId}
        canSteer={canSteer}
        sendControl={sendControl}
      />

      {state.sourceItems.length > 0 ? (
        <details className="research__sources">
          <summary className="small-copy research__sources-summary">
            {state.sourceCount} sources so far
          </summary>
          <ul className="research__sources-list">
            {[...state.sourceItems].reverse().map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="research__source-link"
                  onClick={() => {
                    if (state.researchId !== null) {
                      track({
                        name: "research_source_clicked",
                        researchId: state.researchId,
                        domain: source.domain,
                      });
                    }
                  }}
                >
                  {source.title}
                </a>
                <span className="micro-copy research__source-domain">{source.domain}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {state.bestFit ? (
        <section className="research__best fade-in" aria-label="Best fit so far">
          <div className="research__best-head">
            <span className="kicker">Best fit so far</span>
            <span className="micro-copy">Rankings evolve as evidence arrives.</span>
          </div>
          <p key={state.bestFit.name} className="display display--title research__best-name">
            {state.bestFit.name}
          </p>
          {state.bestFit.priceDisplay ? (
            <p className="research__best-price">{state.bestFit.priceDisplay}</p>
          ) : null}
          {state.bestFit.note ? <p className="small-copy">{state.bestFit.note}</p> : null}
          {state.bestFit.backups.length > 0 ? (
            <p className="micro-copy research__best-backups">
              Also in the running:{" "}
              {state.bestFit.backups.map((backup) => backup.name).join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {state.confirmation ? (
        <p key={state.confirmation.controlId} className="research__toast" role="status">
          {state.confirmation.detail}
        </p>
      ) : null}
    </main>
  );
}

/** Time-saved is always labeled an estimate, with its basis one tap away. */
function TimeSavedChip({ estimate }: { estimate: HoursSaved }) {
  const [basisOpen, setBasisOpen] = useState(false);
  const range =
    estimate.min === estimate.max
      ? `${formatHours(estimate.min)}`
      : `${formatHours(estimate.min)}–${formatHours(estimate.max)}`;
  return (
    <div className="research__saved">
      <button
        type="button"
        className="research__saved-chip"
        aria-expanded={basisOpen}
        onClick={() => setBasisOpen((open) => !open)}
      >
        Est. {range} hrs of research saved
        <span className="research__saved-how" aria-hidden="true">
          {basisOpen ? "· hide how" : "· how?"}
        </span>
      </button>
      {basisOpen ? <p className="micro-copy research__saved-basis fade-in">{estimate.basis}</p> : null}
    </div>
  );
}
