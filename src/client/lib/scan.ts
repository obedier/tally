/**
 * Barcode/SKU scanning helpers — pure functions, no camera, no DOM, so the
 * rules that decide whether a scan is trustworthy can be tested directly.
 *
 * A camera misread is the failure mode that matters here: handing the research
 * engine a wrong product code produces a confident report about the wrong
 * product, which is exactly the kind of quiet wrongness docs/PRODUCT.md forbids.
 * So a decoded value is normalized, bounded, and — when it claims to be a
 * retail product code — check-digit verified before it becomes a query.
 */

import { isGtin, looksLikeGtin } from "../../shared/gtin";

export { isGtin } from "../../shared/gtin";

/** Shortest plausible product identifier (EAN-8 is 8; short SKUs run to ~6). */
const MIN_CODE_LENGTH = 6;
/** Long enough for Code-128 SKUs, short enough to reject decoded paragraphs. */
const MAX_CODE_LENGTH = 48;

/** Characters that appear in real SKUs. Anything else is a misread or a URL. */
const CODE_CHARS = /^[A-Za-z0-9._/]+$/;

/**
 * Cleans a raw decode into a product code, or null when it isn't one.
 * Printed codes are often spaced or hyphenated for legibility ("0 12345 67890 5");
 * the separators are typography, never part of the identifier.
 */
export function normalizeScannedCode(raw: string): string | null {
  const compact = raw.trim().replace(/[\s-]+/g, "");
  if (compact.length < MIN_CODE_LENGTH || compact.length > MAX_CODE_LENGTH) return null;
  if (!CODE_CHARS.test(compact)) return null;
  // Digits are identifiers as-is; alphanumeric SKUs are conventionally upper-case.
  return /^\d+$/.test(compact) ? compact : compact.toUpperCase();
}

/**
 * Decides what to do with a decoded value. Codes shaped like a retail barcode
 * must pass their check digit — a one-digit camera misread fails, and we would
 * rather ask for a re-scan than research the wrong product. Everything else
 * that survives normalization is accepted as a manufacturer SKU, which has no
 * shared checksum to verify against.
 */
export function acceptScannedCode(raw: string): string | null {
  const code = normalizeScannedCode(raw);
  if (code === null) return null;
  if (looksLikeGtin(code) && !isGtin(code)) return null;
  return code;
}

/**
 * Why the camera failed, in terms of what the user can do about it. Each value
 * maps to different copy — "something went wrong" leaves them nowhere to go.
 */
export type CameraFailure = "denied" | "no-camera" | "insecure" | "unavailable";

/**
 * Maps a getUserMedia rejection to the one actionable reason.
 * `NotSupportedError` is what a headless browser and the iOS Simulator report:
 * there is no camera stack at all, which the user reads as "no camera".
 */
export function classifyCameraError(error: unknown): CameraFailure {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError" ||
    name === "NotSupportedError"
  ) {
    return "no-camera";
  }
  // NotReadableError/TrackStartError land here: the hardware exists but is busy.
  return "unavailable";
}

/**
 * The search query a scan produces. The code goes through verbatim: the engine
 * resolves it with grounded search, and inventing a product name here would be
 * fabricating the one fact the scan was supposed to establish.
 */
export function scanQuery(code: string): string {
  return code;
}
