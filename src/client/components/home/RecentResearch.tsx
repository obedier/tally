import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { deleteReport, fetchReports, type ReportListItem } from "../../lib/api";
import { track } from "../../lib/telemetry";

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: ReportListItem[] }
  | { status: "error" };

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "" : dateFormat.format(parsed);
}

/** Saved research from GET /api/reports, with rerun + quiet two-step delete. */
export function RecentResearch() {
  const navigate = useNavigate();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const items = await fetchReports();
      setState({ status: "ready", items });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rerun = (item: ReportListItem) => {
    track({ name: "search_started", query: item.query, mode: "full", entry: "history" });
    navigate(`/research?q=${encodeURIComponent(item.query)}&mode=full`);
  };

  const removeItem = async (id: string) => {
    setConfirmingId(null);
    setDeleteFailedId(null);
    try {
      await deleteReport(id);
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", items: current.items.filter((item) => item.id !== id) }
          : current,
      );
    } catch {
      setDeleteFailedId(id);
    }
  };

  return (
    <section className="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="kicker">
        Recent research
      </h2>

      {state.status === "loading" ? (
        <div className="recent__skeletons" aria-label="Loading saved research">
          <div className="skeleton recent__skeleton" />
          <div className="skeleton recent__skeleton" />
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="small-copy recent__note" role="alert">
          Saved research couldn&rsquo;t be loaded.{" "}
          <button type="button" className="recent__inline-action" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}

      {state.status === "ready" && state.items.length === 0 ? (
        <p className="small-copy recent__note">
          No saved research yet. Run your first search above and it will be
          waiting for you here.
        </p>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="recent__list">
          {state.items.slice(0, 10).map((item) => (
            <li key={item.id} className="recent__row">
              <Link className="recent__open" to={`/report/${item.id}`}>
                <span className="recent__open-copy">
                  <strong>{item.query}</strong>
                  {item.verdictHeadline ? (
                    <span className="micro-copy recent__verdict">{item.verdictHeadline}</span>
                  ) : null}
                </span>
                <span className="micro-copy">{formatDate(item.createdAt)}</span>
              </Link>
              {confirmingId === item.id ? (
                <span className="recent__confirm">
                  <span className="micro-copy">Delete?</span>
                  <button type="button" className="recent__inline-action recent__inline-action--danger" onClick={() => void removeItem(item.id)}>
                    Yes
                  </button>
                  <button type="button" className="recent__inline-action" onClick={() => setConfirmingId(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <span className="recent__controls">
                  <button type="button" className="recent__inline-action" onClick={() => rerun(item)} aria-label={`Search again: ${item.query}`}>
                    Search again
                  </button>
                  <button type="button" className="recent__inline-action recent__inline-action--danger" onClick={() => setConfirmingId(item.id)} aria-label={`Delete ${item.query}`}>
                    Delete
                  </button>
                </span>
              )}
              {deleteFailedId === item.id ? (
                <span className="micro-copy recent__delete-error" role="alert">
                  Couldn&rsquo;t delete — try again.
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
