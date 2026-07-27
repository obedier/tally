import { useCallback, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ResearchModeSchema, type Report, type ResearchMode } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { Sheet } from "../ui/Sheet";
import { ErrorState, PageTop } from "../ui/States";
import { useResearchStream } from "./useResearchStream";
import "./research.css";

const MODE_LABELS: Record<ResearchMode, string> = {
  quick: "Quick research",
  full: "Full research",
  deep: "Deep dive",
};

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function humanizeStage(stage: string): string {
  const words = stage.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Live research: real SSE progress only — no fake percentages, no invented products. */
export function ResearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const query = (params.get("q") ?? "").trim();
  const modeParse = ResearchModeSchema.safeParse(params.get("mode"));
  // Unknown/tampered mode falls back to the CHEAPEST tier, never the most expensive.
  const mode: ResearchMode = modeParse.success ? modeParse.data : "quick";
  const [attempt, setAttempt] = useState(0);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  const onReport = useCallback(
    (report: Report) => {
      track({ name: "report_viewed", reportId: report.id, surface: "research" });
      navigate(`/report/${report.id}`, { replace: true, state: { report } });
    },
    [navigate],
  );

  const stream = useResearchStream(query, mode, attempt, onReport);

  if (!query) {
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

  if (stream.phase === "failed") {
    return (
      <main className="page">
        <PageTop back={{ to: "/", label: "Home" }} />
        <p className="kicker">{MODE_LABELS[mode]}</p>
        <h1 className="display display--headline research__query">{query}</h1>
        <ErrorState
          title="The research didn't finish."
          detail={
            stream.error
              ? stream.error.message
              : "The live connection to the research engine dropped before a verdict was ready. Nothing is shown because nothing was verified."
          }
          onRetry={() => setAttempt((n) => n + 1)}
          retryLabel="Retry research"
        />
      </main>
    );
  }

  const visibleQuestions = stream.questions.filter((question) => question.status !== "removed");
  const doneCount = visibleQuestions.filter((question) => question.status === "done").length;

  return (
    <main className="page research">
      <PageTop back={{ to: "/", label: "Home" }} />

      <header className="research__head">
        <p className="kicker">{MODE_LABELS[mode]}</p>
        <h1 className="display display--headline research__query">{query}</h1>
        <p className="small-copy research__meter" aria-live="polite">
          <span className="research__pulse" aria-hidden="true" />
          {stream.phase === "connecting" ? "Opening live research…" : null}
          {stream.phase === "streaming" && stream.stage
            ? `${humanizeStage(stream.stage.stage)}${stream.stage.detail ? ` — ${stream.stage.detail}` : ""}`
            : null}
          {stream.phase === "streaming" && !stream.stage ? "Researching…" : null}
          {stream.phase === "done" ? "Research complete." : null}
          <span className="research__elapsed">{formatElapsed(stream.elapsedSeconds)} elapsed</span>
        </p>
        <p className="micro-copy research__counts">
          {visibleQuestions.length > 0
            ? `${doneCount} of ${visibleQuestions.length} questions answered · `
            : ""}
          {stream.sourceCount > 0
            ? `${stream.sourceCount} sources consulted so far`
            : "Gathering sources…"}
        </p>
      </header>

      {stream.assumptions.length > 0 ? (
        <section className="research__assumptions" aria-label="What we assumed">
          <div className="research__assumptions-head">
            <h2 className="kicker">What we assumed</h2>
            <button type="button" className="research__review" onClick={() => setAssumptionsOpen(true)}>
              Review
            </button>
          </div>
          <ul className="research__chips">
            {stream.assumptions.map((assumption) => (
              <li key={assumption.id} className={`research__chip${assumption.affirmed ? " research__chip--affirmed" : ""}`}>
                {assumption.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="research__plan" aria-label="Research plan">
        <h2 className="display display--title">Here&rsquo;s what we&rsquo;re checking.</h2>
        {visibleQuestions.length === 0 ? (
          <div className="research__plan-loading">
            <div className="skeleton research__plan-skeleton" />
            <div className="skeleton research__plan-skeleton" />
            <div className="skeleton research__plan-skeleton" />
            <p className="micro-copy">Drafting the research plan for this query…</p>
          </div>
        ) : (
          <ol className="research__questions">
            {visibleQuestions.map((question, index) => (
              <li key={question.id} className={`research__question research__question--${question.status}`}>
                <span className="research__marker" aria-hidden="true">
                  {question.status === "done" ? "✓" : index + 1}
                </span>
                <div>
                  <p className="research__question-text">{question.text}</p>
                  {question.status === "active" ? (
                    <p className="micro-copy research__question-live">
                      <span className="research__pulse research__pulse--accent" aria-hidden="true" />
                      Researching now
                      {question.sourceCount > 0 ? ` · ${question.sourceCount} sources` : ""}
                    </p>
                  ) : null}
                  {question.status === "active" && question.whyItMatters ? (
                    <p className="micro-copy research__why">Why this matters: {question.whyItMatters}</p>
                  ) : null}
                </div>
                <span className="micro-copy research__status-label">
                  {question.status === "done" ? "Complete" : question.status === "active" ? "In progress" : "Upcoming"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {stream.bestFit ? (
        <section className="research__best fade-in" aria-label="Best fit so far">
          <div className="research__best-head">
            <span className="kicker">Best fit so far</span>
            <span className="micro-copy">Rankings evolve as evidence arrives.</span>
          </div>
          <p className="display display--title">{stream.bestFit.name}</p>
          {stream.bestFit.priceDisplay ? (
            <p className="research__best-price">{stream.bestFit.priceDisplay}</p>
          ) : null}
          {stream.bestFit.note ? <p className="small-copy">{stream.bestFit.note}</p> : null}
        </section>
      ) : null}

      <Sheet
        open={assumptionsOpen}
        onClose={() => setAssumptionsOpen(false)}
        title="What we assumed"
        description="These assumptions are steering the research and the ranking."
      >
        <ul className="research__sheet-list">
          {stream.assumptions.map((assumption) => (
            <li key={assumption.id} className="research__sheet-row">
              <span className={`research__sheet-mark${assumption.affirmed ? " research__sheet-mark--on" : ""}`} aria-hidden="true">
                {assumption.affirmed ? "✓" : "·"}
              </span>
              <span>{assumption.text}</span>
              <span className="micro-copy">{assumption.origin === "inferred" ? "Inferred" : "Yours"}</span>
            </li>
          ))}
        </ul>
        <p className="micro-copy research__sheet-note">
          Editing assumptions mid-research is coming next. For now they are
          shown exactly as the engine is using them.
        </p>
      </Sheet>
    </main>
  );
}
