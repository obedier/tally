import { Capacitor } from "@capacitor/core";
import { PUBLIC_ORIGIN } from "./origin";

/**
 * Native shell integration. Everything here no-ops in a browser, so the web
 * build behaves exactly as before.
 */

/** Route inside the app for an incoming deep link, or null if it isn't ours. */
export function deepLinkPath(rawUrl: string, publicOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const isOwnScheme = url.protocol === "tally:";
  const isPublicSite = publicOrigin !== "" && `${url.protocol}//${url.host}` === publicOrigin;
  if (!isOwnScheme && !isPublicSite) return null;

  // tally://report/abc parses host="report", pathname="/abc"; the https form
  // parses host="tally.o11r.com", pathname="/report/abc". Normalise both to
  // the same list of path segments.
  const segments = (isOwnScheme ? `${url.host}${url.pathname}` : url.pathname)
    .split("/")
    .filter((segment) => segment.length > 0);

  // Exactly surface + id. Anything longer is rejected outright rather than
  // read loosely: URL parsing collapses `..` segments, so a link like
  // `tally://report/abc/../../poll/xyz` would otherwise be read as some other
  // id entirely. A deep link we cannot interpret exactly is not one we follow.
  if (segments.length !== 2) return null;
  const [head, id] = segments;
  if (!head || !id) return null;

  // /s/:id is the public share page — in the app that is simply the report.
  if (head === "s" || head === "report") return `/report/${encodeURIComponent(id)}`;
  if (head === "poll") return `/poll/${encodeURIComponent(id)}`;
  return null;
}

/** Matches the app's paper background so the bar never fights the page. */
export async function initStatusBar(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  // Style.Light means dark content — the bar sits on Tally's light paper.
  await StatusBar.setStyle({ style: Style.Light });
}

/**
 * Subscribes to deep links. Returns a cleanup function; a no-op on the web,
 * where the browser handles URLs itself.
 */
export async function onDeepLink(handle: (path: string) => void): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};
  const { App } = await import("@capacitor/app");
  const listener = await App.addListener("appUrlOpen", ({ url }) => {
    const path = deepLinkPath(url, PUBLIC_ORIGIN);
    if (path) handle(path);
  });
  return () => void listener.remove();
}
