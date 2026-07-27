import { useCallback, useEffect, useRef, useState } from "react";
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

/* ------------------------------------------------------------------ */
/* Saved picks (device-local bookmark)                                 */
/* ------------------------------------------------------------------ */

/**
 * Reports are already persisted server-side; "Save this pick" is a neutral,
 * device-local bookmark — never a purchase prompt. Markers key to
 * `${reportId}:${rank}` so the same pick reads as saved on return. Falls back
 * to in-memory when storage is blocked (private mode), matching session.ts.
 */
const SAVED_PICKS_KEY = "tally.savedPicks";
const memorySavedPicks = new Set<string>();

function markerKey(reportId: string, rank: number): string {
  return `${reportId}:${rank}`;
}

function readSavedPicks(): Set<string> {
  try {
    const raw = window.localStorage.getItem(SAVED_PICKS_KEY);
    if (!raw) return new Set(memorySavedPicks);
    const parsed: unknown = JSON.parse(raw);
    const keys = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    return new Set([...keys, ...memorySavedPicks]);
  } catch {
    return new Set(memorySavedPicks);
  }
}

function persistSavedPicks(keys: Set<string>): void {
  try {
    window.localStorage.setItem(SAVED_PICKS_KEY, JSON.stringify([...keys]));
  } catch {
    // Storage blocked — memory set (updated by caller) is the source of truth.
  }
}

export interface SavedPickControls {
  isSaved: (rank: number) => boolean;
  /** Saves the pick (idempotent) and emits pick_saved once per new save. */
  save: (rank: number, pickKind: "best-fit" | "alternative") => void;
}

/**
 * Device-local saved-pick markers for a report, with pick_saved telemetry.
 * Re-reads storage on reportId change so a saved pick persists across visits.
 */
export function useSavedPick(reportId: string | null): SavedPickControls {
  const [keys, setKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!reportId) return;
    setKeys(readSavedPicks());
  }, [reportId]);

  const isSaved = useCallback(
    (rank: number): boolean => (reportId ? keys.has(markerKey(reportId, rank)) : false),
    [keys, reportId],
  );

  const save = useCallback(
    (rank: number, pickKind: "best-fit" | "alternative"): void => {
      if (!reportId) return;
      const key = markerKey(reportId, rank);
      if (keys.has(key)) return; // idempotent: no duplicate telemetry.
      memorySavedPicks.add(key);
      const next = new Set(keys);
      next.add(key);
      persistSavedPicks(next);
      setKeys(next);
      track({ name: "pick_saved", reportId, pickKind, rank });
    },
    [keys, reportId],
  );

  return { isSaved, save };
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
