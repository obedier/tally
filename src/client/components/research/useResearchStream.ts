import { useEffect, useRef, useState } from "react";
import type {
  Assumption,
  PlanQuestion,
  Report,
  ResearchError,
  ResearchMode,
} from "../../../shared/report";
import { openResearchStream } from "../../lib/api";
import { getDeviceId, getSessionId } from "../../lib/session";

export interface StageInfo {
  stage: string;
  status: "started" | "completed" | "failed";
  detail: string | null;
}

export interface BestFitSoFar {
  name: string;
  priceDisplay: string | null;
  note: string | null;
}

export interface StreamState {
  phase: "connecting" | "streaming" | "failed" | "done";
  stage: StageInfo | null;
  assumptions: Assumption[];
  questions: PlanQuestion[];
  sourceCount: number;
  bestFit: BestFitSoFar | null;
  /** Terminal engine error (null for a raw connection drop). */
  error: ResearchError | null;
  elapsedSeconds: number;
}

const INITIAL: StreamState = {
  phase: "connecting",
  stage: null,
  assumptions: [],
  questions: [],
  sourceCount: 0,
  bestFit: null,
  error: null,
  elapsedSeconds: 0,
};

/**
 * Owns the live SSE research stream: real events in, immutable state out.
 * Elapsed time is a wall clock from stream open — honest, never simulated.
 */
export function useResearchStream(
  query: string,
  mode: ResearchMode,
  attempt: number,
  onReport: (report: Report) => void,
): StreamState {
  const [state, setState] = useState<StreamState>(INITIAL);
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;

  useEffect(() => {
    if (!query) return;
    setState(INITIAL);
    const startedAt = Date.now();

    const ticker = window.setInterval(() => {
      setState((current) =>
        current.phase === "connecting" || current.phase === "streaming"
          ? { ...current, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) }
          : current,
      );
    }, 1000);

    const close = openResearchStream({
      query,
      mode,
      sessionId: getSessionId(),
      deviceId: getDeviceId(),
      onEvent: (event) => {
        // Side effects stay out of the state updater (StrictMode re-invokes updaters).
        if (event.type === "report") {
          setState((current) => ({ ...current, phase: "done" }));
          onReportRef.current(event.report);
          return;
        }
        setState((current) => {
          const base = current.phase === "connecting" ? { ...current, phase: "streaming" as const } : current;
          switch (event.type) {
            case "stage":
              return {
                ...base,
                stage: { stage: event.stage, status: event.status, detail: event.detail ?? null },
              };
            case "assumptions":
              return { ...base, assumptions: event.assumptions };
            case "plan":
              return { ...base, questions: event.questions };
            case "sources":
              return { ...base, sourceCount: event.count };
            case "best-fit-so-far":
              return {
                ...base,
                bestFit: { name: event.name, priceDisplay: event.priceDisplay, note: event.note },
              };
            case "error":
              return { ...base, phase: "failed", error: event.error };
          }
        });
      },
      onStreamFailure: () => {
        setState((current) => ({ ...current, phase: "failed", error: null }));
      },
    });

    return () => {
      window.clearInterval(ticker);
      close();
    };
  }, [query, mode, attempt]);

  return state;
}
