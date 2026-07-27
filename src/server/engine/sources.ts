import type { Source, SourceClass } from "../../shared/report";

/**
 * Grounding-chunk handling: dedupe, domain resolution (including Vertex
 * grounding redirect URLs), and sourceClass domain heuristics. Pure functions.
 */

export type RawChunk = { readonly title: string; readonly uri: string };

const GROUNDING_REDIRECT_HOST = "vertexaisearch.cloud.google.com";
const GROUNDING_FALLBACK_DOMAIN = "google-grounding";
const DOMAIN_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;

const OWNER_REVIEW_DOMAINS = ["reddit", "youtube", "quora", "trustpilot", "discord"] as const;

const RETAILER_DOMAINS = [
  "amazon", "walmart", "bestbuy", "target", "costco", "homedepot", "lowes",
  "wayfair", "qvc", "ebay", "newegg", "bhphotovideo", "overstock", "chewy",
  "ikea", "samsclub", "kohls", "macys", "crateandbarrel", "williams-sonoma",
  "surlatable", "rei", "adorama",
] as const;

const EDITORIAL_DOMAINS = [
  "rtings", "wirecutter", "nytimes", "techradar", "tomsguide", "cnet",
  "goodhousekeeping", "seriouseats", "consumerreports", "theverge", "engadget",
  "pcmag", "wired", "digitaltrends", "whathifi", "soundguys", "reviewed",
  "zdnet", "tomshardware", "thespruce", "bonappetit", "epicurious",
  "sleepfoundation", "usatoday", "forbes", "businessinsider", "popsci",
  "howtogeek", "androidauthority", "macrumors", "arstechnica", "usnews",
] as const;

const MANUFACTURER_DOMAINS = [
  "dyson", "sony", "apple", "samsung", "lg", "bose", "dell", "hp", "lenovo",
  "asus", "acer", "microsoft", "anker", "jbl", "sennheiser", "shure",
  "logitech", "garmin", "fitbit", "gopro", "nintendo", "lodge", "cuisinart",
  "kitchenaid", "shark", "ninja", "irobot", "levoit", "coway", "dewalt",
  "makita", "bosch", "philips", "panasonic", "breville", "instantpot",
  "weber", "traeger", "casper", "purple", "tempurpedic", "ooni", "vitamix",
  "lecreuset", "staub",
] as const;

function brandToken(name: string | null): string | null {
  if (name === null) return null;
  const first = name.trim().split(/\s+/)[0] ?? "";
  const token = first.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return token.length >= 3 ? token : null;
}

/** Domain heuristics per docs/ENGINE.md provenance classes. */
export function classifySource(domain: string, brandName: string | null): SourceClass {
  const labels = domain.toLowerCase().split(".").filter((l) => l !== "");
  const has = (names: readonly string[]): boolean => names.some((n) => labels.includes(n));
  if (has(OWNER_REVIEW_DOMAINS) || labels.some((l) => l.includes("forum"))) return "owner-review";
  if (has(RETAILER_DOMAINS)) return "retailer";
  if (has(EDITORIAL_DOMAINS)) return "editorial";
  if (has(MANUFACTURER_DOMAINS)) return "manufacturer";
  const brand = brandToken(brandName);
  if (brand !== null && labels.includes(brand)) return "manufacturer";
  return "other";
}

/**
 * Grounding redirect URLs (vertexaisearch.cloud.google.com) keep their href,
 * but the display domain comes from the chunk title when it looks like a
 * domain, else "google-grounding".
 */
export function domainFromChunk(chunk: RawChunk): string {
  const titleDomain = (): string => {
    const t = chunk.title.trim().toLowerCase().replace(/^www\./, "");
    return DOMAIN_PATTERN.test(t) ? t : GROUNDING_FALLBACK_DOMAIN;
  };
  try {
    const host = new URL(chunk.uri).hostname.toLowerCase().replace(/^www\./, "");
    return host === GROUNDING_REDIRECT_HOST ? titleDomain() : host;
  } catch {
    return titleDomain();
  }
}

/** Dedupes by URL (first occurrence wins), preserving order. */
export function dedupeChunks(chunks: readonly RawChunk[]): RawChunk[] {
  const seen = new Set<string>();
  return chunks.filter((ch) => {
    const key = ch.uri.trim();
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deduped chunks whose hrefs are actually valid URLs (contract requires .url()). */
export function usableChunks(chunks: readonly RawChunk[]): RawChunk[] {
  return dedupeChunks(chunks).filter((ch) => {
    try {
      new URL(ch.uri);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Final Source list: deduped, ids "s1".., domains resolved, classes assigned.
 * Id order matches usableChunks() so prompt-time source labels stay aligned.
 */
export function buildSources(chunks: readonly RawChunk[], brandName: string | null): Source[] {
  return usableChunks(chunks).map((ch, i) => {
    const domain = domainFromChunk(ch);
    return {
      id: `s${i + 1}`,
      title: ch.title.trim() === "" ? domain : ch.title.trim(),
      url: ch.uri,
      domain,
      sourceClass: classifySource(domain, brandName),
    };
  });
}
