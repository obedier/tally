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

/**
 * How many rows to render. Collapsed shows `limit`; revealing shows
 * `expandedLimit`; anything still hidden after that belongs to /history.
 * Undefined `limit` means this list is the whole list (the history route).
 */
export function visibleCount(
  total: number,
  limit: number | undefined,
  expandedLimit: number | undefined,
  expanded: boolean,
): number {
  if (limit === undefined) return total;
  const ceiling = expanded ? (expandedLimit ?? total) : limit;
  return Math.min(total, ceiling);
}

interface RecentResearchProps {
  /** Rows shown before the reveal control; omit to show everything at once. */
  limit?: number;
  /** Rows shown once revealed; past this, the full history route takes over. */
  expandedLimit?: number;
}

/** Saved research from GET /api/reports, with rerun + quiet two-step delete. */
export function RecentResearch({ limit, expandedLimit }: RecentResearchProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [expanded, setExpanded] = useState(false);
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

  const total = state.status === "ready" ? state.items.length : 0;
  const hiddenCount = total - visibleCount(total, limit, expandedLimit, expanded);

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
          No saved research yet — your searches will land here.
        </p>
      ) : null}

      {state.status === "ready" && state.items.length > 0 ? (
        <ul className="recent__list">
          {state.items
            .slice(0, visibleCount(state.items.length, limit, expandedLimit, expanded))
            .map((item) => (
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

      {state.status === "ready" && hiddenCount > 0 ? (
        expanded ? (
          <p className="small-copy recent__see-all">
            <Link to="/history">See all {state.items.length} researches →</Link>
          </p>
        ) : (
          <button type="button" className="recent__more" onClick={() => setExpanded(true)}>
            More ({hiddenCount}) ↓
          </button>
        )
      ) : null}
    </section>
  );
}
