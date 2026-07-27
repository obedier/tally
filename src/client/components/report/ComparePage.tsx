import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import type { Alternative, Report } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { useReport, useReportViewed } from "./useReport";
import "./report.css";
import "./compare.css";

/** Comparison of the best fit + ranked alternatives. Editorial cards on mobile. */
export function ComparePage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useReport(id);
  useReportViewed(state.status === "ready" ? state.report.id : null, "detail");

  if (state.status === "loading") {
    return (
      <main className="page" aria-label="Loading comparison">
        <PageTop back={{ to: `/report/${id ?? ""}`, label: "Report" }} />
        <div className="report__skeletons">
          <div className="skeleton report__skeleton--headline" />
          <div className="skeleton report__skeleton--card" />
          <div className="skeleton report__skeleton--card" />
        </div>
      </main>
    );
  }
  if (state.status === "missing") {
    return (
      <main className="page">
        <PageTop />
        <ReportMissing />
      </main>
    );
  }
  if (state.status === "error") {
    return (
      <main className="page">
        <PageTop />
        <ErrorState title="This comparison couldn't be loaded." detail={state.message} onRetry={reload} />
      </main>
    );
  }
  return <Comparison report={state.report} />;
}

function Comparison({ report }: { report: Report }) {
  const { bestFit } = report;
  const alternatives = [...report.alternatives].sort((a, b) => a.rank - b.rank);

  // Fire once per mounted comparison: the grid being opened is itself the signal.
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (emitted.current === report.id) return;
    emitted.current = report.id;
    track({ name: "comparison_used", reportId: report.id, alternativesShown: alternatives.length });
  }, [report.id, alternatives.length]);

  return (
    <main className="page">
      <PageTop back={{ to: `/report/${report.id}`, label: "Report" }} />
      <p className="kicker">Comparison</p>
      <h1 className="display display--headline">{report.query}</h1>
      <p className="small-copy compare__intro">
        The best fit against the {alternatives.length} strongest alternatives this
        research surfaced, ranked for your assumptions.
      </p>

      <div className="compare__list" role="list">
        <CompareCard
          role="listitem"
          lead
          rank={1}
          name={bestFit.name}
          ratingValue={bestFit.rating?.value ?? null}
          priceDisplay={bestFit.priceRange.display}
          tradeoff={bestFit.whyBest}
          reviewSummary={bestFit.rating?.summary ?? null}
          pros={bestFit.pros}
          cons={bestFit.cons}
        />

        {alternatives.map((alternative) => (
          <CompareCard
            key={`${alternative.rank}-${alternative.name}`}
            role="listitem"
            keyAlternative={alternative.isKeyAlternative}
            rank={alternative.rank}
            name={alternative.name}
            ratingValue={alternative.ratingValue}
            priceDisplay={alternative.priceRange ? alternative.priceRange.display : null}
            tradeoff={alternative.note}
            reviewSummary={alternative.reviewSummary}
            pros={alternative.pros}
            cons={alternative.cons}
          />
        ))}
      </div>
    </main>
  );
}

interface CompareCardProps {
  role: string;
  rank: number;
  name: string;
  ratingValue: number | null;
  priceDisplay: string | null;
  tradeoff: string;
  /** One-line review digest; null omits the row entirely (never a placeholder). */
  reviewSummary: string | null;
  pros: Alternative["pros"];
  cons: Alternative["cons"];
  lead?: boolean;
  keyAlternative?: boolean;
}

/**
 * One competitor. Depth (review digest, pros, cons) renders only when the
 * evidence provided it — empty arrays / null summaries are omitted, never
 * shown as "N/A", keeping the card honest per the no-fabrication rule.
 */
function CompareCard({
  role,
  rank,
  name,
  ratingValue,
  priceDisplay,
  tradeoff,
  reviewSummary,
  pros,
  cons,
  lead = false,
  keyAlternative = false,
}: CompareCardProps) {
  return (
    <article
      className={`compare-card${lead ? " compare-card--lead" : ""}${keyAlternative ? " compare-card--key" : ""}`}
      role={role}
    >
      <header className="compare-card__head">
        <span className={`compare-card__rank${lead ? " compare-card__rank--lead" : ""}`}>#{rank}</span>
        <h2 className="compare-card__name">{name}</h2>
        {keyAlternative ? (
          <span className="micro-copy compare-card__key-tag">A different priority</span>
        ) : null}
      </header>

      <div className="compare-card__meta">
        {priceDisplay ? <span className="compare-card__price">{priceDisplay}</span> : null}
        {ratingValue !== null ? (
          <span className="compare-card__rating">{ratingValue} / 5</span>
        ) : (
          <span className="compare-card__rating compare-card__rating--none">No verified rating</span>
        )}
      </div>

      <p className="small-copy compare-card__tradeoff">{tradeoff}</p>

      {reviewSummary ? (
        <p className="micro-copy compare-card__reviews">{reviewSummary}</p>
      ) : null}

      {pros.length > 0 || cons.length > 0 ? (
        <div className="compare-card__pros-cons">
          {pros.length > 0 ? (
            <div className="compare-card__col">
              <h3 className="kicker">Pros</h3>
              <ul>
                {pros.map((pro) => (
                  <li key={pro}>{pro}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {cons.length > 0 ? (
            <div className="compare-card__col">
              <h3 className="kicker kicker--accent">Cons</h3>
              <ul>
                {cons.map((con) => (
                  <li key={con}>{con}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
