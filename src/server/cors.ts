import type { Context, Next } from "hono";

/**
 * Cross-origin access for the native shell.
 *
 * The web client is served by this same process, so it never needs CORS. The
 * iOS/Android shells serve their bundle from a local webview origin and call
 * this deployment across origins, so those origins — and only those — are
 * allowed. The allowlist is exact-match: no wildcard, no reflected-origin
 * echo, because these endpoints create and delete stored research.
 *
 * Credentials are never allowed: Tally has no cookie session, so a stolen
 * origin cannot ride an ambient credential even if the allowlist were wrong.
 */

/** Webview origins Capacitor serves the bundle from. */
export const NATIVE_ORIGINS = [
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
] as const;

const ALLOWED_HEADERS = "content-type";
const ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";
/** Preflight result cache — one day, the common browser ceiling. */
const MAX_AGE_SECONDS = 86_400;

/** Extra origins from `CORS_ALLOWED_ORIGINS` (comma-separated), for staging builds. */
export function parseExtraOrigins(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

export function isAllowedOrigin(origin: string | undefined, extra: readonly string[]): boolean {
  if (!origin) return false;
  return NATIVE_ORIGINS.includes(origin as (typeof NATIVE_ORIGINS)[number]) || extra.includes(origin);
}

/**
 * Hono middleware. Answers preflights itself and stamps allowed responses;
 * a request from an unknown origin is served without CORS headers, so the
 * browser — not this server — refuses it.
 */
export function corsMiddleware(extraOrigins: readonly string[] = parseExtraOrigins(process.env.CORS_ALLOWED_ORIGINS)) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origin = c.req.header("origin");
    const allowed = isAllowedOrigin(origin, extraOrigins);

    if (c.req.method === "OPTIONS") {
      if (!allowed) return c.body(null, 403);
      return c.body(null, 204, {
        "Access-Control-Allow-Origin": origin as string,
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": String(MAX_AGE_SECONDS),
        Vary: "Origin",
      });
    }

    await next();

    if (allowed) {
      c.header("Access-Control-Allow-Origin", origin as string);
      c.header("Vary", "Origin");
    }
  };
}
