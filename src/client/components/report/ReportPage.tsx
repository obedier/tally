import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Assumption, Report, ResearchMode } from "../../../shared/report";
import { buildResearchPath } from "../../lib/api";
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { FeedbackButtons } from "./FeedbackButtons";
import { PriceWatchButton } from "./PriceWatchButton";
import { Attribution, BlockMark, ShareButton } from "./ShareBar";
import { SourcesSheet } from "./SourcesSheet";
import { useReport, useReportViewed, useSavedPick, type SavedPickControls } from "./useReport";
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
  const savedPick = useSavedPick(report.id);
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
        <BlockMark />
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
          <span className="kicker"><span className="report__rank">#1</span> Best fit</span>
          <Link
            className="report__price report__price--link"
            to={`/report/${report.id}/prices`}
            aria-label="See the retailer listings behind this price range"
          >
            {bestFit.priceRange.display} <span aria-hidden="true">›</span>
          </Link>
        </div>
        {bestFit.imageUrl ? (
          <img
            className="report__product-img"
            src={bestFit.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => event.currentTarget.remove()}
          />
        ) : null}
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
        <div className="report__pick-actions">
          <SavePickButton controls={savedPick} rank={1} pickKind="best-fit" label="Save this pick" />
          <PriceWatchButton reportId={report.id} rank={1} pickName={bestFit.name} />
        </div>
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
        <BlockMark />
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
          <SavePickButton
            controls={savedPick}
            rank={keyAlternative.rank}
            pickKind="alternative"
            label="Save as backup pick"
          />
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
        <AssumptionsEditor
          assumptions={report.assumptions}
          query={report.query}
          mode={report.meta.mode}
        />
      ) : null}

      <div className="report__share-row">
        <ShareButton reportId={report.id} surface="report" />
        <p className="micro-copy report__share-note">Good enough to send to a friend.</p>
      </div>

      <FeedbackButtons reportId={report.id} />

      <Attribution />

      <SourcesSheet report={report} open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
    </main>
  );
}

/**
 * A neutral device-local bookmark for a pick — never a purchase prompt, no
 * urgency. Once saved it reads "Saved" and can't re-fire telemetry.
 */
function SavePickButton({
  controls,
  rank,
  pickKind,
  label,
}: {
  controls: SavedPickControls;
  rank: number;
  pickKind: "best-fit" | "alternative";
  label: string;
}) {
  const saved = controls.isSaved(rank);
  return (
    <button
      type="button"
      className={`report__save-pick${saved ? " report__save-pick--saved" : ""}`}
      onClick={() => controls.save(rank, pickKind)}
      disabled={saved}
      aria-pressed={saved}
    >
      <span aria-hidden="true">{saved ? "✓" : "＋"}</span>
      {saved ? "Saved to your picks" : label}
    </button>
  );
}

interface AssumptionDraft {
  id: string;
  text: string;
  affirmed: boolean;
}

/**
 * "What we assumed", changeable without retyping the query. Reword or dismiss
 * an assumption here, then re-run: the edits are carried to a fresh research
 * session (query + mode), which never mutates THIS report — nothing shown is
 * ever relabeled after the fact. You can keep steering assumptions live while
 * the new research runs.
 */
function AssumptionsEditor({
  assumptions,
  query,
  mode,
}: {
  assumptions: Assumption[];
  query: string;
  mode: ResearchMode;
}) {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<AssumptionDraft[]>(() =>
    assumptions.map((a) => ({ id: a.id, text: a.text, affirmed: a.affirmed })),
  );
  const [editingId, setEditingId] = useState<string | null>(null);

  const original = new Map(assumptions.map((a) => [a.id, a] as const));
  const dirty = drafts.some((d) => {
    const base = original.get(d.id);
    return base ? base.text !== d.text || base.affirmed !== d.affirmed : false;
  });

  const setDraft = (id: string, patch: Partial<AssumptionDraft>): void => {
    setDrafts((current) => current.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const rerun = (): void => {
    // Carry the revised assumptions in navigation state so a fresh session can
    // seed them; the URL still re-runs the query even if they aren't consumed.
    navigate(buildResearchPath({ query, mode }), {
      state: { assumptionEdits: drafts },
    });
  };

  return (
    <section className="report__assumptions" aria-label="What we assumed">
      <h2 className="kicker">What we assumed</h2>
      <p className="micro-copy report__assumptions-lead">
        Reword or dismiss any of these, then re-run — your changes steer a fresh research pass.
      </p>
      <ul className="report__assumption-edit-list">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className={`report__assumption-edit${draft.affirmed ? "" : " report__assumption-edit--dismissed"}`}
          >
            {editingId === draft.id ? (
              <div className="report__assumption-reword">
                <label className="micro-copy" htmlFor={`assumption-${draft.id}`}>
                  Reword this assumption
                </label>
                <input
                  id={`assumption-${draft.id}`}
                  className="report__assumption-input"
                  type="text"
                  value={draft.text}
                  onChange={(event) => setDraft(draft.id, { text: event.target.value })}
                  enterKeyHint="done"
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <button
                  type="button"
                  className="report__assumption-action"
                  onClick={() => setEditingId(null)}
                  disabled={!draft.text.trim()}
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="report__assumption-view">
                <span className="report__assumption-text">
                  {draft.text}
                  {draft.affirmed ? null : (
                    <span className="report__assumption-tag">Dismissed</span>
                  )}
                </span>
                <span className="report__assumption-controls">
                  <button
                    type="button"
                    className="report__assumption-action"
                    onClick={() => {
                      setDraft(draft.id, { affirmed: true });
                      setEditingId(draft.id);
                    }}
                  >
                    Reword
                  </button>
                  <button
                    type="button"
                    className="report__assumption-action"
                    onClick={() => setDraft(draft.id, { affirmed: !draft.affirmed })}
                    aria-pressed={!draft.affirmed}
                  >
                    {draft.affirmed ? "Dismiss" : "Restore"}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      {dirty ? (
        <button type="button" className="report__assumptions-rerun" onClick={rerun}>
          Re-run research with these changes <span aria-hidden="true">→</span>
        </button>
      ) : null}
    </section>
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
