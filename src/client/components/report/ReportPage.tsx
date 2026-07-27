import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Report, ResearchMode } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { SourcesSheet } from "./SourcesSheet";
import { useReport, useReportViewed } from "./useReport";
import "./report.css";

const MODE_KICKERS: Record<ResearchMode, string> = {
  quick: "Quick research report",
  full: "Full research report",
  deep: "Deep dive report",
};

/** Report summary: verdict first, evidence one tap away. */
export function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useReport(id);
  useReportViewed(state.status === "ready" ? state.report.id : null, "summary");

  if (state.status === "loading") return <ReportSkeleton />;
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
        <ErrorState title="This report couldn't be loaded." detail={state.message} onRetry={reload} />
      </main>
    );
  }
  return <ReportSummary report={state.report} />;
}

function ReportSummary({ report }: { report: Report }) {
  const navigate = useNavigate();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { verdict, bestFit } = report;
  const keyAlternative = report.alternatives.find((alternative) => alternative.isKeyAlternative) ?? null;

  // Deep dive starts a NEW live session on the same query; the research page
  // owns the session POST — this action only navigates with intent recorded.
  const startDeepDive = (): void => {
    track({ name: "deep_dive_started", fromReportId: report.id });
    navigate(`/research?${new URLSearchParams({ q: report.query, mode: "deep" }).toString()}`);
  };

  return (
    <main className="page report">
      <PageTop back={{ to: "/", label: "Home" }} />

      <header className="report__lead">
        <p className="kicker report__eyebrow">
          {MODE_KICKERS[report.meta.mode]} · {verdict.confidence} confidence
          <button
            type="button"
            className="report__why-confidence"
            aria-expanded={reasonOpen}
            onClick={() => setReasonOpen((open) => !open)}
          >
            Why?
          </button>
        </p>
        {reasonOpen ? (
          <p className="small-copy report__confidence-reason fade-in">{verdict.confidenceReason}</p>
        ) : null}
        <p className="micro-copy report__query">{report.query}</p>
        <h1 className="display display--headline">{verdict.headline}</h1>
        <p className="body-copy report__rationale">{verdict.rationale}</p>
      </header>

      <section className="report__decisive" aria-label="Decisive factors">
        <h2 className="kicker kicker--accent">What would change this call</h2>
        <ul>
          {verdict.decisiveFactors.map((factor) => (
            <li key={factor}>{factor}</li>
          ))}
        </ul>
      </section>

      <section className="report__best" aria-label="Best fit">
        <div className="report__best-head">
          <span className="kicker">Best fit</span>
          <span className="report__price">{bestFit.priceRange.display}</span>
        </div>
        <h2 className="display display--title">{bestFit.name}</h2>
        {bestFit.rating ? (
          <p className="small-copy report__rating">
            {bestFit.rating.value !== null ? (
              <strong>{bestFit.rating.value} / {bestFit.rating.outOf}</strong>
            ) : null}{" "}
            {bestFit.rating.summary}
          </p>
        ) : null}
        <p className="body-copy report__why-best">{bestFit.whyBest}</p>
        <div className="report__pros-cons">
          <div>
            <h3 className="kicker">Top pros</h3>
            <ul>
              {bestFit.pros.map((pro) => (
                <li key={pro}>{pro}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="kicker kicker--accent">Top cons</h3>
            <ul>
              {bestFit.cons.map((con) => (
                <li key={con}>{con}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {keyAlternative ? (
        <section className="report__alternative" aria-label="Key alternative">
          <h2 className="kicker">A different priority?</h2>
          <p className="serif-note report__alternative-name">{keyAlternative.name}</p>
          <p className="small-copy">{keyAlternative.note}</p>
          <p className="micro-copy report__alternative-meta">
            {keyAlternative.priceRange ? keyAlternative.priceRange.display : null}
            {keyAlternative.priceRange && keyAlternative.ratingValue !== null ? " · " : null}
            {keyAlternative.ratingValue !== null ? `${keyAlternative.ratingValue} / 5` : null}
          </p>
        </section>
      ) : null}

      {report.meta.disagreements.length > 0 ? (
        <section className="report__disagreements" aria-label="Where sources disagree">
          <h2 className="kicker">Where sources disagree</h2>
          <ul>
            {report.meta.disagreements.map((item) => (
              <li key={item} className="small-copy">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="report__links" aria-label="Report sections">
        {report.alternatives.length > 0 ? (
          <Link className="report__link" to={`/report/${report.id}/compare`}>
            Compare with {report.alternatives.length} top alternatives <span aria-hidden="true">→</span>
          </Link>
        ) : null}
        <Link className="report__link" to={`/report/${report.id}/prices`}>
          {report.retailers.length > 0
            ? `See ${report.retailers.length} retailer ${report.retailers.length === 1 ? "listing" : "listings"}`
            : "See retailer availability"}{" "}
          <span aria-hidden="true">→</span>
        </Link>
        <button type="button" className="report__link" onClick={() => setSourcesOpen(true)}>
          Sources · {report.sources.length} <span aria-hidden="true">↗</span>
        </button>
        {report.meta.mode !== "deep" ? (
          <>
            <button type="button" className="report__link" onClick={startDeepDive}>
              Go deeper on this <span aria-hidden="true">→</span>
            </button>
            <p className="micro-copy">
              Deep dive: Tally keeps researching until the evidence is conclusive.
            </p>
          </>
        ) : null}
      </nav>

      {report.assumptions.length > 0 ? (
        <section className="report__assumptions" aria-label="What we assumed">
          <h2 className="kicker">What we assumed</h2>
          <ul className="report__chips">
            {report.assumptions.map((assumption) => (
              <li key={assumption.id}>{assumption.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <SourcesSheet report={report} open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </main>
  );
}

function ReportSkeleton() {
  return (
    <main className="page" aria-label="Loading report">
      <PageTop back={{ to: "/", label: "Home" }} />
      <div className="report__skeletons">
        <div className="skeleton report__skeleton--kicker" />
        <div className="skeleton report__skeleton--headline" />
        <div className="skeleton report__skeleton--copy" />
        <div className="skeleton report__skeleton--card" />
      </div>
    </main>
  );
}
