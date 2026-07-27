import { nanoid } from "nanoid";
import type {
  Location,
  ResearchControl,
  ResearchEvent,
  ResearchMode,
  SeedAssumption,
} from "../../shared/report";
import { runResearch } from "./pipeline";

/**
 * In-memory live research sessions keyed by researchId. Each session keeps an
 * append-only ResearchEvent log (so a reconnecting client replays losslessly),
 * a subscriber set for live fan-out, and a control queue the pipeline drains
 * at stage boundaries. Single-process V1 server; sessions are GC'd 30 minutes
 * after their terminal event.
 */

const GC_AFTER_TERMINAL_MS = 30 * 60 * 1000;

export type SessionStatus = "running" | "completed" | "failed";

type Listener = (event: ResearchEvent) => void;

type Session = {
  readonly id: string;
  readonly events: ResearchEvent[];
  readonly subscribers: Set<Listener>;
  readonly controlQueue: ResearchControl[];
  status: SessionStatus;
};

const sessions = new Map<string, Session>();

const isTerminalEvent = (event: ResearchEvent): boolean =>
  event.type === "report" || event.type === "error";

function scheduleGc(id: string): void {
  const timer = setTimeout(() => {
    sessions.delete(id);
  }, GC_AFTER_TERMINAL_MS);
  timer.unref();
}

export type StartSessionInput = {
  readonly query: string;
  readonly mode: ResearchMode;
  readonly sessionId?: string;
  readonly deviceId?: string;
  /** Coarse buyer location resolved by the route (geo header or user input). */
  readonly location?: Location | null;
  /** User-edited assumptions carried from a prior report (M3 re-run with changes). */
  readonly seedAssumptions?: readonly SeedAssumption[];
};

/** Starts the pipeline asynchronously; returns the researchId immediately. */
export function startResearchSession(input: StartSessionInput): string {
  const id = nanoid(12);
  const session: Session = {
    id,
    events: [],
    subscribers: new Set(),
    controlQueue: [],
    status: "running",
  };
  sessions.set(id, session);

  const emit = (event: ResearchEvent): void => {
    session.events.push(event);
    if (isTerminalEvent(event) && session.status === "running") {
      session.status = event.type === "report" ? "completed" : "failed";
      scheduleGc(id);
    }
    for (const listener of session.subscribers) {
      try {
        listener(event);
      } catch (err) {
        console.error("[session] subscriber threw", err);
      }
    }
  };

  const drainControls = (): ResearchControl[] =>
    session.controlQueue.splice(0, session.controlQueue.length);

  void runResearch({ ...input, researchId: id, emit, drainControls }).catch((err) => {
    // The pipeline emits its own terminal error event before throwing; this is
    // a defensive net so a session can never hang open without a terminal event.
    if (session.status === "running") {
      console.error("[session] pipeline rejected without a terminal event", err);
      emit({
        type: "error",
        error: {
          ok: false,
          code: "research-failed",
          message: "Live research failed unexpectedly. Please retry.",
          retryable: true,
        },
      });
    }
  });

  return id;
}

export type SessionSubscription = {
  /** Snapshot of every event logged so far, in order — replay these first. */
  readonly replay: readonly ResearchEvent[];
  readonly unsubscribe: () => void;
};

/**
 * Atomically snapshots the event log and registers a live listener, so the
 * caller sees every event exactly once and in order. Returns null for unknown
 * (or GC'd) session ids.
 */
export function subscribeToSession(id: string, listener: Listener): SessionSubscription | null {
  const session = sessions.get(id);
  if (session === undefined) return null;
  const replay = [...session.events];
  session.subscribers.add(listener);
  return {
    replay,
    unsubscribe: (): void => {
      session.subscribers.delete(listener);
    },
  };
}

export function getSessionStatus(id: string): SessionStatus | null {
  return sessions.get(id)?.status ?? null;
}

export type QueueControlResult = "queued" | "not-found" | "terminal";

/** Queues a validated control for the pipeline's next boundary drain. */
export function queueControl(id: string, control: ResearchControl): QueueControlResult {
  const session = sessions.get(id);
  if (session === undefined) return "not-found";
  if (session.status !== "running") return "terminal";
  session.controlQueue.push(control);
  return "queued";
}
