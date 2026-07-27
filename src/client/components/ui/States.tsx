import { Link } from "react-router-dom";
import { Lockup } from "./Lockup";

/** Top-of-page nav for inner screens: mini lockup + optional back link. */
export function PageTop({ back }: { back?: { to: string; label: string } }) {
  return (
    <nav className="page-top" aria-label="Page navigation">
      <Lockup variant="mini" />
      {back ? (
        <Link className="page-top__back" to={back.to}>
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      ) : null}
    </nav>
  );
}

interface ErrorStateProps {
  title: string;
  detail: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Quiet, honest error state — plain language, a way forward, never blank. */
export function ErrorState({ title, detail, onRetry, retryLabel = "Try again" }: ErrorStateProps) {
  return (
    <div className="state-block fade-in" role="alert">
      <p className="serif-note">{title}</p>
      <p className="small-copy state-block__detail">{detail}</p>
      <div className="state-block__actions">
        {onRetry ? (
          <button type="button" className="button-primary" onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
        <Link className="button-quiet" to="/">
          Back home
        </Link>
      </div>
    </div>
  );
}

/** Friendly 404 for a report id that doesn't exist. */
export function ReportMissing() {
  return (
    <div className="state-block fade-in">
      <p className="display display--title">This research isn&rsquo;t here.</p>
      <p className="small-copy state-block__detail">
        It may have been deleted, or the link is off by a character. Start a
        fresh search and Tally will do the digging again.
      </p>
      <div className="state-block__actions">
        <Link className="button-primary" to="/">
          Back home
        </Link>
      </div>
    </div>
  );
}
