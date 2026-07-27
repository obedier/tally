import { useParams } from "react-router-dom";
import type { Report, RetailerListing } from "../../../shared/report";
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { useReport, useReportViewed } from "./useReport";
import "./report.css";

/** Retailer listings grouped online / local. Rows link out only when a real URL exists. */
export function PricesPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useReport(id);
  useReportViewed(state.status === "ready" ? state.report.id : null, "prices");

  if (state.status === "loading") {
    return (
      <main className="page" aria-label="Loading prices">
        <PageTop back={{ to: `/report/${id ?? ""}`, label: "Report" }} />
        <div className="report__skeletons">
          <div className="skeleton report__skeleton--headline" />
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
        <ErrorState title="Prices couldn't be loaded." detail={state.message} onRetry={reload} />
      </main>
    );
  }
  return <Prices report={state.report} />;
}

function Prices({ report }: { report: Report }) {
  const online = report.retailers.filter((listing) => listing.kind !== "local");
  const local = report.retailers.filter((listing) => listing.kind !== "online");

  return (
    <main className="page">
      <PageTop back={{ to: `/report/${report.id}`, label: "Report" }} />
      <p className="kicker">Price check</p>
      <h1 className="display display--headline">{report.bestFit.name}</h1>
      {report.bestFit.priceRange.min !== null || report.bestFit.priceRange.max !== null ? (
        <p className="small-copy compare__intro">
          Current range: <strong className="prices__range">{report.bestFit.priceRange.display}</strong>.
          Prices move — confirm the listing before you buy or visit.
        </p>
      ) : (
        <p className="small-copy compare__intro">
          We couldn't confirm a live price range for this pick — check a retailer below.
          Prices move — confirm the listing before you buy or visit.
        </p>
      )}

      {report.retailers.length === 0 ? (
        <p className="small-copy prices__empty">
          No retailer listings were verified for this report, so none are shown.
          Rerun the research to check again.
        </p>
      ) : (
        <>
          <RetailerGroup title="Online" listings={online} reportId={report.id} />
          <RetailerGroup title="Local" listings={local} reportId={report.id} />
        </>
      )}
    </main>
  );
}

function RetailerGroup({
  title,
  listings,
  reportId,
}: {
  title: string;
  listings: RetailerListing[];
  reportId: string;
}) {
  if (listings.length === 0) return null;
  return (
    <section className="prices__group" aria-label={`${title} retailers`}>
      <h2 className="kicker">{title}</h2>
      <ul className="prices__list">
        {listings.map((listing) => (
          <li key={`${listing.kind}-${listing.seller}`}>
            {listing.url ? (
              <a
                className="prices__row prices__row--link"
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track({
                    name: "retailer_clicked",
                    reportId,
                    seller: listing.seller,
                    kind: listing.kind,
                  })
                }
              >
                <RetailerRowBody listing={listing} linked />
              </a>
            ) : (
              <div className="prices__row">
                <RetailerRowBody listing={listing} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RetailerRowBody({ listing, linked = false }: { listing: RetailerListing; linked?: boolean }) {
  // Avoid the same fallback text appearing twice in one row (e.g. availability
  // and price both reading "Check retailer").
  const duplicated =
    listing.availability.trim().toLowerCase() === listing.price.display.trim().toLowerCase();
  return (
    <>
      <div className="prices__seller">
        <strong>{listing.seller}</strong>
        {duplicated ? null : <span className="micro-copy">{listing.availability}</span>}
      </div>
      <span className="prices__amount">
        {listing.price.display}
        {linked ? <span aria-hidden="true"> ↗</span> : null}
      </span>
    </>
  );
}
