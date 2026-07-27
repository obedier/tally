import { z } from "zod";
import {
  ReportSchema,
  ResearchEventSchema,
  ResearchResponseSchema,
  type Report,
  type ResearchEvent,
  type ResearchMode,
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

export interface ResearchStreamOptions {
  query: string;
  mode: ResearchMode;
  sessionId: string;
  deviceId: string;
  onEvent: (event: ResearchEvent) => void;
  /** Fired when the stream drops before a terminal `report`/`error` event. */
  onStreamFailure: () => void;
}

const EVENT_NAMES = [
  "stage",
  "assumptions",
  "plan",
  "sources",
  "best-fit-so-far",
  "report",
  "error",
] as const;

/**
 * Opens the live research SSE stream. Handles both SSE conventions: default
 * `message` events carrying `{ type }` payloads, and named events. Returns a
 * close function; the stream is closed automatically after a terminal event.
 */
export function openResearchStream(options: ResearchStreamOptions): () => void {
  const params = new URLSearchParams({
    query: options.query,
    mode: options.mode,
    sessionId: options.sessionId,
    deviceId: options.deviceId,
  });
  const source = new EventSource(`/api/research/stream?${params.toString()}`);
  let terminal = false;
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
      terminal = true;
      close();
    }
    options.onEvent(parsed.data);
  };

  source.onmessage = (event) => handlePayload(event.data as string, "message");
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      handlePayload((event as MessageEvent<string>).data, name);
    });
  }
  source.onerror = () => {
    if (terminal || closed) return;
    close();
    options.onStreamFailure();
  };

  return close;
}
