/**
 * Where the API and the public share pages actually live.
 *
 * On the web the client is served by the same origin as the API, so every
 * request stays relative and works unchanged on localhost, staging and prod.
 * The native shell (Capacitor) serves the bundle from `capacitor://localhost`,
 * which has no server behind it — those builds are compiled with an explicit
 * `VITE_PUBLIC_ORIGIN` so requests reach the real deployment.
 *
 * `VITE_PUBLIC_ORIGIN` is a public URL and nothing else. `GEMINI_API_KEY`
 * stays server-only per CLAUDE.md and is never reachable from import.meta.env.
 */

/** Strip trailing slashes so `origin + "/api/x"` never doubles up. */
export function normalizeOrigin(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

/**
 * Absolute URL for an API path. With no configured origin (the web build) the
 * path is returned untouched so the request stays same-origin and relative.
 */
export function resolveApiUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

/**
 * Public share link for a report. Never `capacitor://localhost/s/...` — a link
 * that only opens on the sharer's own phone is worse than no share at all, so
 * the configured public origin always wins in the native shell.
 */
export function resolveShareUrl(origin: string, fallbackOrigin: string, reportId: string): string {
  const base = origin || normalizeOrigin(fallbackOrigin);
  return `${base}/s/${reportId}`;
}

/** "" on the web (same-origin, relative), the deployment URL in the native shell. */
export const PUBLIC_ORIGIN = normalizeOrigin(import.meta.env.VITE_PUBLIC_ORIGIN);

/** True when this bundle is the native shell talking to a remote deployment. */
export const isRemoteOrigin = PUBLIC_ORIGIN !== "";

/** Absolute URL for an API path, correct on both web and native. */
export function apiUrl(path: string): string {
  return resolveApiUrl(PUBLIC_ORIGIN, path);
}

/** Public, shareable `/s/:id` link, correct on both web and native. */
export function shareUrl(reportId: string): string {
  return resolveShareUrl(PUBLIC_ORIGIN, window.location.origin, reportId);
}
