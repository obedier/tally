import { z } from "zod";
import {
  ReportSchema,
  ResearchErrorSchema,
  ResearchEventSchema,
  ResearchResponseSchema,
  StartSessionResponseSchema,
  type Report,
  type ResearchControl,
  type ResearchError,
  type ResearchEvent,
  type ResearchMode,
  type SeedAssumption,
} from "../../shared/report";

/**
 * Typed API access. Every response is zod-parsed against the shared report
 * contract before it reaches a component — the client trusts nothing.
 */

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class ReportNotFoundError extends ApiError {
  constructor() {
    super("Report not found", 404);
  }
}

/** A structured engine error (a parsed ResearchError body) surfaced as an exception. */
export class ResearchRequestError extends ApiError {
  readonly code: ResearchError["code"];
  readonly retryable: boolean;
  constructor(error: ResearchError, status: number) {
    super(error.message, status);
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

/**
 * Saved-research list item. The shared contract does not define a list shape,
 * so we require only the fields the home screen renders; unknown extras are
 * stripped, full Report objects also parse.
 */
export const ReportListItemSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  createdAt: z.string(),
  verdictHeadline: z.string().optional(),
});
export type ReportListItem = z.infer<typeof ReportListItemSchema>;

/** Server responds `{ reports }`; an `ok` flag is tolerated if one appears. */
const ReportListResponseSchema = z.object({
  ok: z.literal(true).optional(),
  reports: z.array(ReportListItemSchema),
});

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError("The server returned an unreadable response.", response.status);
  }
}

/** Like readJson but never throws — error paths often carry empty bodies. */
async function readJsonQuietly(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** GET /api/reports — saved research, newest first (server order preserved). */
export async function fetchReports(): Promise<ReportListItem[]> {
  const response = await fetch("/api/reports");
  if (!response.ok) {
    throw new ApiError("Saved research could not be loaded.", response.status);
  }
  const json = await readJson(response);
  const enveloped = ReportListResponseSchema.safeParse(json);
  if (enveloped.success) return enveloped.data.reports;
  const bare = z.array(ReportListItemSchema).safeParse(json);
  if (bare.success) return bare.data;
  throw new ApiError("Saved research arrived in an unexpected shape.", response.status);
}

/** GET /api/reports/:id — a full validated report. */
export async function fetchReport(id: string): Promise<Report> {
  const response = await fetch(`/api/reports/${encodeURIComponent(id)}`);
  if (response.status === 404) throw new ReportNotFoundError();
  if (!response.ok) {
    throw new ApiError("This report could not be loaded.", response.status);
  }
  const json = await readJson(response);
  const enveloped = ResearchResponseSchema.safeParse(json);
  if (enveloped.success) return enveloped.data.report;
  /** Server responds `{ report }` without an ok flag; a bare report also parses. */
  const wrapped = z.object({ report: ReportSchema }).safeParse(json);
  if (wrapped.success) return wrapped.data.report;
  const bare = ReportSchema.safeParse(json);
  if (bare.success) return bare.data;
  throw new ApiError("This report arrived in an unexpected shape.", response.status);
}

/** DELETE /api/reports/:id */
export async function deleteReport(id: string): Promise<void> {
  const response = await fetch(`/api/reports/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new ApiError("This research could not be deleted.", response.status);
  }
}

/* ------------------------------------------------------------------ */
/* Live research sessions                                              */
/* ------------------------------------------------------------------ */

export interface StartSessionRequest {
  query: string;
  mode: ResearchMode;
  sessionId: string;
  deviceId: string;
  /**
   * Coarse buyer location to scope local retailers (M3). Sent as `body.location`
   * only when present; the server reads it. Never precise — city/region only.
   */
  location?: string;
  /** User-edited assumptions carried from a report into this re-run (M3). */
  seedAssumptions?: readonly SeedAssumption[];
}

/** Params for a client-initiated (re)run navigation to /research. */
export interface ResearchNavParams {
  query: string;
  mode: ResearchMode;
  /** Coarse location to scope the rerun; carried as ?location= for the session start. */
  location?: string;
}

/**
 * Builds the /research path for a (re)run. Centralized here so every surface
 * that re-runs research (prices location edit, report assumption edit, history)
 * produces the same URL contract: ?q=&mode=(&location=).
 */
export function buildResearchPath({ query, mode, location }: ResearchNavParams): string {
  const params = new URLSearchParams({ q: query, mode });
  const trimmed = location?.trim();
  if (trimmed) params.set("location", trimmed);
  return `/research?${params.toString()}`;
}

/** POST /api/research/session — starts a live session, returns its researchId. */
export async function startResearchSession(request: StartSessionRequest): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/research/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    throw new ApiError(
      "Tally couldn't reach the research engine. Check your connection and try again.",
      0,
    );
  }
  const json = await readJsonQuietly(response);
  const started = StartSessionResponseSchema.safeParse(json);
  if (response.ok && started.success) return started.data.researchId;
  const failure = ResearchErrorSchema.safeParse(json);
  if (failure.success) throw new ResearchRequestError(failure.data, response.status);
  if (response.status === 429) {
    throw new ResearchRequestError(
      {
        ok: false,
        code: "rate-limited",
        message: "Tally is busy right now. Give it a moment, then try again.",
        retryable: true,
      },
      429,
    );
  }
  throw new ApiError("The research session could not be started.", response.status);
}

function sessionEventsUrl(researchId: string): string {
  return `/api/research/session/${encodeURIComponent(researchId)}/events`;
}

export type SessionProbe = "ok" | "missing" | "unreachable";

/**
 * EventSource hides HTTP status codes, so a garbage-collected session (404)
 * looks identical to a network blip. This probe fetches the stream endpoint
 * once, reads only the status, and cancels the body immediately.
 */
export async function probeResearchSession(researchId: string): Promise<SessionProbe> {
  try {
    const response = await fetch(sessionEventsUrl(researchId), {
      headers: { accept: "text/event-stream" },
    });
    void response.body?.cancel();
    if (response.status === 404) return "missing";
    return response.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

const EVENT_NAMES = [
  "stage",
  "assumptions",
  "plan",
  "sources",
  "best-fit-so-far",
  "time-saved",
  "control-applied",
  "report",
  "error",
] as const;

export interface SessionStreamHandlers {
  onEvent: (event: ResearchEvent) => void;
  /**
   * Fired on every connection error. EventSource keeps auto-reconnecting (the
   * server replays prior events on reconnect) until the caller closes it —
   * the caller owns the give-up policy.
   */
  onConnectionError: () => void;
}

/**
 * Opens the session SSE stream (GET /api/research/session/:id/events). The
 * server replays all prior events on connect, then streams live. Handles both
 * SSE conventions: default `message` events carrying `{ type }` payloads, and
 * named events. Returns a close function; the stream is closed automatically
 * after a terminal `report`/`error` event.
 */
export function openSessionStream(researchId: string, handlers: SessionStreamHandlers): () => void {
  const source = new EventSource(sessionEventsUrl(researchId));
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    source.close();
  };

  const handlePayload = (raw: string, eventName: string): void => {
    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return; // Heartbeats / non-JSON frames are ignored.
    }
    if (
      data !== null &&
      typeof data === "object" &&
      !("type" in data) &&
      eventName !== "message"
    ) {
      data = { ...data, type: eventName };
    }
    const parsed = ResearchEventSchema.safeParse(data);
    if (!parsed.success) return;
    if (parsed.data.type === "report" || parsed.data.type === "error") {
      close();
    }
    handlers.onEvent(parsed.data);
  };

  source.onmessage = (event) => handlePayload(event.data as string, "message");
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      handlePayload((event as MessageEvent<string>).data, name);
    });
  }
  source.onerror = () => {
    if (closed) return;
    handlers.onConnectionError();
  };

  return close;
}

/** POST /api/research/session/:id/control — apply a mid-run steering change. */
export async function postResearchControl(
  researchId: string,
  control: ResearchControl,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/research/session/${encodeURIComponent(researchId)}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(control),
    });
  } catch {
    throw new ApiError("The change didn't reach the engine — check your connection.", 0);
  }
  if (response.ok) return;
  const json = await readJsonQuietly(response);
  const failure = ResearchErrorSchema.safeParse(json);
  if (failure.success) throw new ResearchRequestError(failure.data, response.status);
  throw new ApiError("The change couldn't be applied.", response.status);
}
