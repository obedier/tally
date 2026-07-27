import { track } from "./telemetry";

/**
 * Report feedback ("Was this helpful?"), M5 query-mining signal.
 *
 * Design choice: telemetry-only. A thumbs rating is a low-value, high-volume
 * signal whose entire consumer is the mining job, which already reads the
 * `telemetry_events` table. Adding a bespoke endpoint + table would duplicate
 * the existing, privacy-guarded ingest path for no benefit. So feedback rides
 * the standard telemetry queue as a `report_feedback` event — validated
 * server-side against the shared schema exactly like every other event.
 *
 * No PII is attached: only the anonymous reportId + the rating enum.
 */

export type FeedbackRating = "up" | "down";

/** Emit a single thumbs rating for a report. Idempotency is the caller's job. */
export function sendFeedback(reportId: string, rating: FeedbackRating): void {
  track({ name: "report_feedback", reportId, rating });
}
