import { useParams } from "react-router-dom";
import type { Report } from "../../../shared/report";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { useReport, useReportViewed } from "./useReport";
import "./report.css";

/** Comparison of the best fit + ranked alternatives. Cards on mobile, grid wider. */
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

  return (
    <main className="page">
      <PageTop back={{ to: `/report/${report.id}`, label: "Report" }} />
      <p className="kicker">Comparison</p>
      <h1 className="display display--headline">{report.query}</h1>
      <p className="small-copy compare__intro">
        The best fit against the {alternatives.length} strongest alternatives this
        research surfaced, ranked for your assumptions.
      </p>

      <div className="compare__grid" role="list">
        <div className="compare__head" aria-hidden="true">
          <span>Product</span>
          <span>Rating</span>
          <span>Price</span>
          <span>The tradeoff</span>
        </div>

        <article className="compare__row compare__row--lead" role="listitem">
          <div className="compare__name">
            <span className="compare__rank compare__rank--lead">#1</span>
            <strong>{bestFit.name}</strong>
          </div>
          {bestFit.rating && bestFit.rating.value !== null ? (
            <span className="compare__rating">{`${bestFit.rating.value} / 5`}</span>
          ) : (
            <span className="compare__rating" aria-label="No verified rating" />
          )}
          <span className="compare__price">{bestFit.priceRange.display}</span>
          <span className="compare__note">{bestFit.whyBest}</span>
        </article>

        {alternatives.map((alternative) => (
          <article
            key={`${alternative.rank}-${alternative.name}`}
            className={`compare__row${alternative.isKeyAlternative ? " compare__row--key" : ""}`}
            role="listitem"
          >
            <div className="compare__name">
              <span className="compare__rank">#{alternative.rank}</span>
              <strong>{alternative.name}</strong>
              {alternative.isKeyAlternative ? (
                <span className="micro-copy compare__key-tag">A different priority</span>
              ) : null}
            </div>
            {alternative.ratingValue !== null ? (
              <span className="compare__rating">{`${alternative.ratingValue} / 5`}</span>
            ) : (
              <span className="compare__rating" aria-label="No verified rating" />
            )}
            <span className="compare__price">
              {alternative.priceRange ? alternative.priceRange.display : ""}
            </span>
            <span className="compare__note">{alternative.note}</span>
          </article>
        ))}
      </div>
    </main>
  );
}
