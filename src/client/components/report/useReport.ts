import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ReportSchema, type Report } from "../../../shared/report";
import { fetchReport, ReportNotFoundError } from "../../lib/api";
import { track } from "../../lib/telemetry";

export type ReportState =
  | { status: "loading" }
  | { status: "ready"; report: Report }
  | { status: "missing" }
  | { status: "error"; message: string };

/**
 * Loads a report by id. A report handed over via navigation state (from live
 * research) is zod-validated and used immediately; otherwise GET /api/reports/:id.
 */
export function useReport(id: string | undefined): { state: ReportState; reload: () => void } {
  const location = useLocation();
  const handedOver = extractHandedOverReport(location.state, id);
  const [state, setState] = useState<ReportState>(
    handedOver ? { status: "ready", report: handedOver } : { status: "loading" },
  );
  const [reloadKey, setReloadKey] = useState(0);
  const hasHandover = useRef(handedOver !== null);

  useEffect(() => {
    if (!id) {
      setState({ status: "missing" });
      return;
    }
    if (hasHandover.current && reloadKey === 0) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchReport(id)
      .then((report) => {
        if (!cancelled) setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ReportNotFoundError) setState({ status: "missing" });
        else setState({ status: "error", message: "This report couldn't be loaded right now." });
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  return { state, reload: () => setReloadKey((key) => key + 1) };
}

function extractHandedOverReport(state: unknown, id: string | undefined): Report | null {
  if (!id || state === null || typeof state !== "object" || !("report" in state)) return null;
  const parsed = ReportSchema.safeParse((state as { report: unknown }).report);
  return parsed.success && parsed.data.id === id ? parsed.data : null;
}

/** Emits report_viewed once per report id + surface per mount. */
export function useReportViewed(
  reportId: string | null,
  surface: "summary" | "detail" | "prices",
): void {
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!reportId) return;
    const key = `${reportId}:${surface}`;
    if (seen.current === key) return;
    seen.current = key;
    track({ name: "report_viewed", reportId, surface });
  }, [reportId, surface]);
}
