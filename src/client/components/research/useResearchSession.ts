import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Assumption,
  HoursSaved,
  PlanQuestion,
  Report,
  ResearchControl,
  ResearchError,
  ResearchEvent,
  ResearchMode,
} from "../../../shared/report";
import {
  ApiError,
  openSessionStream,
  postResearchControl,
  probeResearchSession,
  startResearchSession,
} from "../../lib/api";
import { getDeviceId, getSessionId } from "../../lib/session";
import { track } from "../../lib/telemetry";

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

export type SessionPhase =
  | "starting" /* POSTing the session */
  | "connecting" /* SSE opening */
  | "streaming"
  | "missing" /* session 404 — GC'd on the server */
  | "failed"
  | "done";

export interface SessionState {
  phase: SessionPhase;
  researchId: string | null;
  stage: StageInfo | null;
  assumptions: Assumption[];
  questions: PlanQuestion[];
  sourceCount: number;
  bestFit: BestFitSoFar | null;
  hoursSaved: HoursSaved | null;
  /** Terminal engine error (null for a raw connection drop). */
  error: ResearchError | null;
  elapsedSeconds: number;
  /** Quiet server acknowledgement of a control this client sent. */
  confirmation: { controlId: string; detail: string } | null;
  /** Visible control-failure note; persists until dismissed. */
  controlNote: string | null;
}

const INITIAL: SessionState = {
  phase: "starting",
  researchId: null,
  stage: null,
  assumptions: [],
  questions: [],
  sourceCount: 0,
  bestFit: null,
  hoursSaved: null,
  error: null,
  elapsedSeconds: 0,
  confirmation: null,
  controlNote: null,
};

/** The slice of state a control may optimistically change (and roll back). */
export interface SteerableState {
  assumptions: Assumption[];
  questions: PlanQuestion[];
}
export type OptimisticUpdate = (current: SteerableState) => Partial<SteerableState>;
export type SendControl = (
  control: ResearchControl,
  optimistic: OptimisticUpdate,
) => Promise<boolean>;

export interface UseResearchSessionArgs {
  /** react-router location key: unique per navigation, stable across remounts. */
  locationKey: string;
  query: string;
  mode: ResearchMode;
  /** Session id from the URL; null until the session has been started. */
  rid: string | null;
  attempt: number;
  onReport: (report: Report) => void;
  /** Called once the POST returns; the page replaces the URL with ?rid=. */
  onResearchId: (researchId: string) => void;
}

export interface UseResearchSession {
  state: SessionState;
  sendControl: SendControl;
  dismissControlNote: () => void;
}

/** Give up after this many consecutive SSE errors with no event in between. */
const MAX_STREAM_ERRORS = 4;
const CONFIRMATION_MS = 4500;
const START_CACHE_MAX = 24;
const TELEMETRY_ENDPOINT = "/api/events";

/**
 * StrictMode (and back/forward remounts) must never double-POST a session —
 * research costs real money. Keyed by location key + attempt so a genuine new
 * navigation or retry starts fresh while a remount reuses the in-flight POST.
 */
const startCache = new Map<string, Promise<string>>();

/** Sessions whose abandonment has already been reported (once per research). */
const abandonedSessions = new Set<string>();

function rememberStart(key: string, promise: Promise<string>): void {
  startCache.set(key, promise);
  if (startCache.size > START_CACHE_MAX) {
    const oldest = startCache.keys().next().value;
    if (oldest !== undefined) startCache.delete(oldest);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong starting the research.";
}

function toResearchError(error: unknown): ResearchError {
  return {
    ok: false,
    code: "research-failed",
    message: toErrorMessage(error),
    retryable: true,
  };
}

/**
 * Abandonment must survive the page dying: build the envelope locally and
 * sendBeacon a single-event batch directly. The shared telemetry queue can't
 * be used here because its pagehide flush runs before this component's
 * listeners get a chance to enqueue.
 */
function beaconAbandoned(researchId: string, stage: string, elapsedMs: number): void {
  const body = { name: "research_abandoned" as const, researchId, stage, elapsedMs };
  const event = {
    eventId: nanoid(21),
    sessionId: getSessionId(),
    deviceId: getDeviceId(),
    ts: new Date().toISOString(),
    ...body,
  };
  const payload = new Blob([JSON.stringify({ events: [event] })], {
    type: "application/json",
  });
  const sent =
    typeof navigator.sendBeacon === "function" &&
    navigator.sendBeacon(TELEMETRY_ENDPOINT, payload);
  if (!sent) track(body);
}

/** Pure event → state reduction for non-terminal, non-control events. */
function applyStreamEvent(current: SessionState, event: ResearchEvent): SessionState {
  const base: SessionState =
    current.phase === "connecting" ? { ...current, phase: "streaming" } : current;
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
    case "time-saved":
      return { ...base, hoursSaved: event.estimate };
    default:
      return base;
  }
}

/**
 * Owns the live research session: starts it (POST) when arriving with a query,
 * reconnects + replays when arriving with a rid, streams real events into
 * immutable state, applies mid-run controls optimistically with rollback, and
 * reports abandonment. Elapsed time is a wall clock reconciled against the
 * server's stage timings — honest, never simulated.
 */
export function useResearchSession(args: UseResearchSessionArgs): UseResearchSession {
  const { locationKey, query, mode, rid, attempt, onReport, onResearchId } = args;
  const [state, setState] = useState<SessionState>(INITIAL);

  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  const onResearchIdRef = useRef(onResearchId);
  onResearchIdRef.current = onResearchId;
  const stateRef = useRef(state);
  stateRef.current = state;

  const startedAtRef = useRef(Date.now());
  /** Live-session facts used by controls + abandonment, safe from stale closures. */
  const liveRef = useRef<{ researchId: string | null; stage: string | null; terminal: boolean }>({
    researchId: null,
    stage: null,
    terminal: false,
  });
  /** controlIds this client sent and hasn't seen acknowledged or fail yet. */
  const pendingControlsRef = useRef<Set<string>>(new Set());
  const confirmationTimerRef = useRef<number | null>(null);

  /* -------------------------------------------------- start (POST) */
  useEffect(() => {
    if (rid !== null || !query) return;
    let cancelled = false;
    setState({ ...INITIAL, phase: "starting" });
    const cacheKey = `${locationKey}:${attempt}`;
    const promise =
      startCache.get(cacheKey) ??
      startResearchSession({
        query,
        mode,
        sessionId: getSessionId(),
        deviceId: getDeviceId(),
      });
    rememberStart(cacheKey, promise);
    promise
      .then((researchId) => {
        if (!cancelled) onResearchIdRef.current(researchId);
      })
      .catch((error: unknown) => {
        startCache.delete(cacheKey);
        if (cancelled) return;
        setState((current) => ({ ...current, phase: "failed", error: toResearchError(error) }));
      });
    return () => {
      cancelled = true;
    };
  }, [locationKey, query, mode, rid, attempt]);

  /* -------------------------------------------------- connect (SSE) */
  useEffect(() => {
    if (rid === null) return;
    liveRef.current = { researchId: rid, stage: null, terminal: false };
    startedAtRef.current = Date.now();
    setState({ ...INITIAL, phase: "connecting", researchId: rid });
    let disposed = false;
    let receivedEvent = false;
    let consecutiveErrors = 0;
    let probing = false;

    const ticker = window.setInterval(() => {
      setState((current) =>
        current.phase === "connecting" || current.phase === "streaming"
          ? { ...current, elapsedSeconds: Math.floor((Date.now() - startedAtRef.current) / 1000) }
          : current,
      );
    }, 1000);

    const showConfirmation = (controlId: string, detail: string): void => {
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current);
      }
      setState((current) => ({ ...current, confirmation: { controlId, detail } }));
      confirmationTimerRef.current = window.setTimeout(() => {
        confirmationTimerRef.current = null;
        setState((current) => ({ ...current, confirmation: null }));
      }, CONFIRMATION_MS);
    };

    const fail = (error: ResearchError | null): void => {
      liveRef.current.terminal = true;
      setState((current) =>
        current.phase === "done" ? current : { ...current, phase: "failed", error },
      );
    };

    const close = openSessionStream(rid, {
      onEvent: (event) => {
        if (disposed) return;
        receivedEvent = true;
        consecutiveErrors = 0;
        if (event.type === "stage") {
          liveRef.current.stage = event.stage;
          // The server's elapsedMs is truth; never show less than it.
          startedAtRef.current = Math.min(startedAtRef.current, Date.now() - event.elapsedMs);
        }
        if (event.type === "report") {
          liveRef.current.terminal = true;
          setState((current) => ({ ...current, phase: "done" }));
          onReportRef.current(event.report);
          return;
        }
        if (event.type === "error") {
          fail(event.error);
          return;
        }
        if (event.type === "control-applied") {
          // Only acknowledge controls THIS client sent; replayed history from
          // a reconnect must not resurface old confirmations.
          if (!pendingControlsRef.current.has(event.controlId)) return;
          pendingControlsRef.current.delete(event.controlId);
          showConfirmation(event.controlId, event.detail);
          return;
        }
        setState((current) => applyStreamEvent(current, event));
      },
      onConnectionError: () => {
        if (disposed) return;
        consecutiveErrors += 1;
        if (!receivedEvent) {
          // Nothing ever arrived: distinguish a GC'd session (404) from a blip.
          if (probing) return;
          probing = true;
          void probeResearchSession(rid).then((result) => {
            probing = false;
            if (disposed) return;
            if (result === "missing") {
              close();
              liveRef.current.terminal = true;
              setState((current) => ({ ...current, phase: "missing" }));
              return;
            }
            if (consecutiveErrors >= MAX_STREAM_ERRORS) {
              close();
              fail(null);
            }
          });
          return;
        }
        // Mid-run drop: EventSource auto-reconnects and the server replays;
        // only give up after repeated failures with no progress between them.
        if (consecutiveErrors >= MAX_STREAM_ERRORS) {
          close();
          fail(null);
        }
      },
    });

    const emitAbandoned = (viaBeacon: boolean): void => {
      const live = liveRef.current;
      if (live.researchId === null || live.terminal || live.stage === null) return;
      if (abandonedSessions.has(live.researchId)) return;
      abandonedSessions.add(live.researchId);
      const elapsedMs = Math.max(0, Date.now() - startedAtRef.current);
      if (viaBeacon) {
        beaconAbandoned(live.researchId, live.stage, elapsedMs);
        return;
      }
      track({
        name: "research_abandoned",
        researchId: live.researchId,
        stage: live.stage,
        elapsedMs,
      });
    };

    const onPageHide = (): void => emitAbandoned(true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(ticker);
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current);
        confirmationTimerRef.current = null;
      }
      emitAbandoned(false);
      close();
    };
  }, [rid, attempt]);

  /* -------------------------------------------------- controls */
  const sendControl = useCallback<SendControl>(async (control, optimistic) => {
    const { researchId, terminal } = liveRef.current;
    if (researchId === null || terminal) return false;
    const snapshot: SteerableState = {
      assumptions: stateRef.current.assumptions,
      questions: stateRef.current.questions,
    };
    pendingControlsRef.current.add(control.controlId);
    setState((current) => ({
      ...current,
      ...optimistic({ assumptions: current.assumptions, questions: current.questions }),
      controlNote: null,
    }));
    try {
      await postResearchControl(researchId, control);
      return true;
    } catch (error: unknown) {
      // Roll back visibly — no silent failure. The next server plan/assumptions
      // event remains the final source of truth either way.
      pendingControlsRef.current.delete(control.controlId);
      const message =
        error instanceof ApiError ? error.message : "That change didn't go through. Try again.";
      setState((current) => ({
        ...current,
        assumptions: snapshot.assumptions,
        questions: snapshot.questions,
        controlNote: message,
      }));
      return false;
    }
  }, []);

  const dismissControlNote = useCallback(() => {
    setState((current) => ({ ...current, controlNote: null }));
  }, []);

  return { state, sendControl, dismissControlNote };
}
