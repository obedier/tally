import { nanoid } from "nanoid";
import type { EventBody, TelemetryEvent } from "../../shared/telemetry";
import { getDeviceId, getSessionId } from "./session";

/**
 * Client telemetry queue. Batches events to POST /api/events, flushing every
 * 5 seconds, at 10 queued events, or on pagehide via sendBeacon.
 * Envelope per src/shared/telemetry.ts; ids are anonymous only.
 */

const ENDPOINT = "/api/events";
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT_COUNT = 10;
/** TelemetryBatchSchema caps a batch at 50 events. */
const MAX_BATCH = 50;
/** Drop oldest beyond this to bound memory if the server is unreachable. */
const MAX_QUEUE = 200;

let queue: TelemetryEvent[] = [];
let flushTimer: number | null = null;
let isFlushing = false;

function buildEvent(body: EventBody): TelemetryEvent {
  return {
    eventId: nanoid(21),
    sessionId: getSessionId(),
    deviceId: getDeviceId(),
    ts: new Date().toISOString(),
    ...body,
  };
}

/** Queue a telemetry event; flushing is automatic. */
export function track(body: EventBody): void {
  queue = [...queue, buildEvent(body)].slice(-MAX_QUEUE);
  if (queue.length >= FLUSH_AT_COUNT) {
    void flush();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (isFlushing || queue.length === 0) return;
  isFlushing = true;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (!response.ok) {
      requeue(batch);
    }
  } catch {
    requeue(batch);
  } finally {
    isFlushing = false;
    if (queue.length >= FLUSH_AT_COUNT) void flush();
    else if (queue.length > 0) scheduleFlush();
  }
}

function requeue(batch: TelemetryEvent[]): void {
  queue = [...batch, ...queue].slice(-MAX_QUEUE);
}

function flushWithBeacon(): void {
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  const payload = new Blob([JSON.stringify({ events: batch })], {
    type: "application/json",
  });
  const sent =
    typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, payload);
  if (sent) queue = queue.slice(batch.length);
}

let initialized = false;

/** Call once at app boot: wires pagehide flushing. */
export function initTelemetry(): void {
  if (initialized) return;
  initialized = true;
  window.addEventListener("pagehide", flushWithBeacon);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWithBeacon();
  });
}
