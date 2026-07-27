import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Location, Report, RetailerListing } from "../../../shared/report";
import { buildResearchPath } from "../../lib/api";
import { track } from "../../lib/telemetry";
import { ErrorState, PageTop, ReportMissing } from "../ui/States";
import { useReport, useReportViewed } from "./useReport";
import "./report.css";
import "./prices.css";

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
  // A retailer appears in exactly one group. "online-local" sellers have a
  // physical presence (and carry a locality), so they belong under Local; the
  // Online group is pure-online only — no locality label ever shows there.
  const online = report.retailers.filter((listing) => listing.kind === "online");
  const local = report.retailers.filter((listing) => listing.kind !== "online");

  return (
    <main className="page">
      <PageTop back={{ to: `/report/${report.id}`, label: "Report" }} />
      <p className="kicker">Price check</p>
      <h1 className="display display--headline">{report.bestFit.name}</h1>
      {report.bestFit.priceRange.min !== null || report.bestFit.priceRange.max !== null ? (
        <p className="small-copy compare__intro">
          Current range: <strong className="prices__range">{report.bestFit.priceRange.display}</strong> —
          the retailer listings below are what make up that range.
          Prices move — confirm the listing before you buy or visit.
        </p>
      ) : (
        <p className="small-copy compare__intro">
          We couldn't confirm a live price range for this pick — check a retailer below.
          Prices move — confirm the listing before you buy or visit.
        </p>
      )}

      <LocationControl location={report.location} query={report.query} mode={report.meta.mode} />

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

const LOCATION_SOURCE_LABEL: Record<Location["source"], string> = {
  ip: "detected",
  user: "you set",
  default: "default",
};

/**
 * Shows the coarse location that scoped local prices and lets the user change
 * it. Editing re-runs research for the new location (a fresh session) — it does
 * NOT mutate the current report, so nothing stale is ever relabeled. Honest
 * about how the location was set; never a purchase prompt.
 */
function LocationControl({
  location,
  query,
  mode,
}: {
  location: Report["location"];
  query: Report["query"];
  mode: Report["meta"]["mode"];
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(location?.label ?? "");

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const next = value.trim();
    if (!next) return;
    navigate(buildResearchPath({ query, mode, location: next }));
  };

  return (
    <section className="prices__location" aria-label="Location for local prices">
      {editing ? (
        <form className="prices__location-form" onSubmit={submit}>
          <label className="micro-copy prices__location-label" htmlFor="prices-location">
            City or region for local prices
          </label>
          <div className="prices__location-row">
            <input
              id="prices-location"
              className="prices__location-input"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="e.g. Seattle, WA"
              autoComplete="address-level2"
              enterKeyHint="search"
              maxLength={120}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <button type="submit" className="prices__location-button" disabled={!value.trim()}>
              Update
            </button>
          </div>
          <p className="micro-copy prices__location-hint">
            Updating re-runs the research for this location — nothing here is changed until it finishes.
          </p>
        </form>
      ) : (
        <p className="small-copy prices__location-current">
          <span className="prices__location-pin" aria-hidden="true">◎</span>
          {location ? (
            <>
              Local prices for <strong>{location.label}</strong>{" "}
              <span className="micro-copy prices__location-source">({LOCATION_SOURCE_LABEL[location.source]})</span>
            </>
          ) : (
            <>No location set — local prices aren't scoped to a place.</>
          )}
          <button
            type="button"
            className="prices__location-edit"
            onClick={() => setEditing(true)}
          >
            {location ? "Change" : "Set location"}
          </button>
        </p>
      )}
    </section>
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
        <span className="prices__seller-meta">
          {duplicated ? null : <span className="micro-copy">{listing.availability}</span>}
          {listing.locality ? (
            <span className="micro-copy prices__locality">in {listing.locality}</span>
          ) : null}
        </span>
      </div>
      <span className="prices__amount">
        {listing.price.display}
        {linked ? <span aria-hidden="true"> ↗</span> : null}
      </span>
    </>
  );
}
