/**
 * Display helpers for source provenance.
 *
 * A product photo in Tally is evidence, not decoration: it was harvested from a
 * page this research actually cited. Crediting the host says so out loud, which
 * is why the image can be absent without the card looking broken — it never
 * promised a photo, it offered a citation that happened to carry one.
 */

/** Bare display host for a URL ("www." dropped); null when unparseable. */
export function displayHost(url: string | null): string | null {
  if (url === null) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host === "" ? null : host;
  } catch {
    return null;
  }
}
