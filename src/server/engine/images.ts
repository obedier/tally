/**
 * Harvests real product imagery from pages this research actually cited.
 * og:image / twitter:image only, taken from cited source and retailer URLs —
 * honest provenance, never stock, never generated. Best-effort under hard time
 * budgets: a miss is null, never a substitute image.
 *
 *   candidate URLs (cited sources, retailer links — model-derived)
 *          │
 *          ▼
 *   candidateUrls()      ✂ homepages (brand furniture) · search pages (no product)
 *          │
 *          ▼
 *   fetchPage()          ✂ non-public hosts (SSRF) · non-HTML · 403 · 3s timeout
 *          │               redirects followed MANUALLY, re-validated each hop
 *          ▼
 *   pageMatchesProduct() ✂ pages whose title doesn't identify THIS product
 *          │               (model tokens all present + majority match)
 *          ▼
 *   JSON-LD Product image  ??  og:image     ✂ logos, banners, video thumbnails
 *          │
 *          ▼
 *   imageUrl | null       ── outcome counted, never silently discarded
 *
 * Two filters in series (candidateUrls, pageMatchesProduct) are individually
 * correct and jointly remove most of the supply — measured hit rate is ~24% on
 * the best fit. That is why harvestImages reports an outcome: three rewrites of
 * this file could not tell improvement from motion because nothing counted.
 */

const FETCH_TIMEOUT_MS = 3000;
/** Redirect hops followed by hand so every hop can be re-validated. */
const MAX_REDIRECTS = 3;
/**
 * Candidate pages tried per pick. Most retail fetches die instantly on a 403,
 * so a low cap mostly buys refusals; attempts run concurrently and share one
 * page cache, so raising this costs little and is what actually finds images.
 */
const MAX_URLS_PER_PICK = 6;
/** Realistic UA — some retail pages serve bots an empty shell. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const OG_PATTERNS: readonly RegExp[] = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
];

/**
 * Site logos and default banners posing as og:image are worse than no image —
 * they'd read as the product. Reject anything that looks like brand furniture.
 */
const GENERIC_IMAGE_RE =
  /logo|brandmark|favicon|wordmark|sprite|placeholder|og[-_]?default|default[-_]?og|social[-_]?(default|share|card)|site[-_]?icon|banner[-_]?generic|walmartimages\.com\/dfw\/|ebaystatic\.com/i;

/**
 * Video thumbnails are a reviewer's face or a clickbait frame, not the product,
 * and a review video's og:image passes every other check here. Two of these
 * shipped as product photos before anyone counted image sources.
 */
const VIDEO_THUMB_RE =
  /(^|\.)(ytimg\.com|vimeocdn\.com|tiktokcdn\.com|dailymotion\.com|jwpcdn\.com)$/i;

export function isVideoThumbnail(url: string): boolean {
  try {
    return VIDEO_THUMB_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Hosts the server must never fetch. Candidate URLs originate in model output,
 * so this is an SSRF boundary: without it a cited "source" pointing at
 * 127.0.0.1 or a cloud metadata address would be fetched by the server.
 *
 * Honest limit: this checks the hostname, so a public name that RESOLVES to a
 * private address still passes (DNS rebinding). Closing that needs resolution
 * before connect; the bounded blast radius here — the response is parsed for
 * og/JSON-LD and never returned to a client — doesn't justify it yet.
 * Tracked in TODOS.md.
 */
const PRIVATE_HOST_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const PRIVATE_IPV4_RE =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isPubliclyFetchable(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host)) return false;
  if (PRIVATE_IPV4_RE.test(host)) return false;
  // IPv6 literals arrive bracket-stripped from URL.hostname.
  if (host === "::1" || host === "::") return false;
  if (/^(fe80|fc|fd)/i.test(host) && host.includes(":")) return false;
  return true;
}

/**
 * A retailer HOMEPAGE's og:image is its brand image, never the product (a live
 * report shipped the Walmart logo this way) — only pages with a real path can
 * be product/article pages worth fetching.
 */
export function isRootUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return true;
  }
}

export function isLikelyGenericImage(url: string): boolean {
  return GENERIC_IMAGE_RE.test(url);
}

/**
 * Retailer *search* pages — the shape deepRetailerUrl() produces when a model
 * gives us a bare homepage. They are correct destinations for a shopper and
 * worthless here: a results grid has no product og:image, only store branding.
 * Fetching them burns the time budget before real sources are ever tried.
 */
const SEARCH_PATH_RE = /(^\/s$|\/search|catalogsearch|searchpage|\/sch\/|\/browse$)/i;
const SEARCH_PARAM_KEYS = ["q", "k", "st", "keyword", "searchterm", "query", "_nkw"];

export function isSearchUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (SEARCH_PATH_RE.test(u.pathname)) return true;
    for (const key of u.searchParams.keys()) {
      if (SEARCH_PARAM_KEYS.includes(key.toLowerCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Pages worth fetching for a pick, in priority order and de-duplicated.
 * Homepages carry brand furniture; search pages carry nothing.
 */
export function candidateUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const url of urls) {
    if (isRootUrl(url) || isSearchUrl(url) || seen.has(url)) continue;
    seen.add(url);
    kept.push(url);
    if (kept.length >= MAX_URLS_PER_PICK) break;
  }
  return kept;
}

const TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "pro", "max", "plus", "mini", "new", "best",
]);

/** Significant lowercase tokens of a product name (model numbers included). */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !TOKEN_STOPWORDS.has(t) && (t.length >= 3 || /\d/.test(t)));
}

const TITLE_PATTERNS: readonly RegExp[] = [
  /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
  /<title[^>]*>([^<]+)<\/title>/i,
];

/**
 * A cited page only gets to contribute an image if its own title identifies the
 * product — otherwise a roundup or unrelated article ships its hero image as
 * "the product" (a live report showed a Dutch oven on a vacuum page this way).
 *
 * Identification, not mere mention. A brand name alone names a catalogue: a
 * "Dyson V12 Detect Slim Review" page matched "Dyson Gen5detect" on the word
 * "dyson" and handed three different vacuums the same photo. So every token
 * carrying a model identifier must be present, and a majority of tokens must
 * match before a page may speak for a product.
 */
export function pageMatchesProduct(html: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const titles = TITLE_PATTERNS.map((p) => html.match(p)?.[1] ?? "").join(" ").toLowerCase();
  if (titles.trim() === "") return false;

  const modelTokens = tokens.filter((t) => /\d/.test(t));
  if (modelTokens.some((t) => !titles.includes(t))) return false;

  const hits = tokens.filter((t) => titles.includes(t)).length;
  // A confirmed model number is strong evidence on its own; without one, a
  // single word (almost always the brand) is not enough.
  const required = Math.max(modelTokens.length > 0 ? 1 : 2, Math.ceil(tokens.length / 2));
  return hits >= required;
}

/**
 * schema.org Product images name the actual product (og:image is often just
 * the article hero) — prefer them when a cited page embeds Product JSON-LD.
 */
export function extractJsonLdProductImage(html: string, baseUrl: string): string | null {
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    const raw = match[1];
    if (raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      continue;
    }
    const image = findProductImage(parsed, 0);
    if (image === null) continue;
    try {
      const resolved = new URL(image, baseUrl);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
      const asString = resolved.toString();
      if (isLikelyGenericImage(asString) || isVideoThumbnail(asString)) continue;
      return asString;
    } catch {
      continue;
    }
  }
  return null;
}

/** Walks JSON-LD (incl. @graph/arrays) for a Product node's first image URL. */
function findProductImage(node: unknown, depth: number): string | null {
  if (depth > 4 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductImage(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  const isProduct =
    type === "Product" || (Array.isArray(type) && type.includes("Product"));
  if (isProduct) {
    const image = firstImageUrl(obj["image"]);
    if (image !== null) return image;
  }
  return findProductImage(obj["@graph"], depth + 1);
}

function firstImageUrl(image: unknown): string | null {
  if (typeof image === "string" && image.trim() !== "") return image.trim();
  if (Array.isArray(image)) {
    for (const item of image) {
      const found = firstImageUrl(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (image !== null && typeof image === "object") {
    const url = (image as Record<string, unknown>)["url"];
    if (typeof url === "string" && url.trim() !== "") return url.trim();
  }
  return null;
}

/** Pulls the first non-generic og/twitter image; absolute http(s) URLs only. */
export function extractOgImage(html: string, baseUrl: string): string | null {
  for (const pattern of OG_PATTERNS) {
    const match = html.match(pattern);
    const raw = match?.[1]?.trim();
    if (raw === undefined || raw === "") continue;
    try {
      const resolved = new URL(raw, baseUrl);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
      const asString = resolved.toString();
      if (isLikelyGenericImage(asString) || isVideoThumbnail(asString)) continue;
      return asString;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetches one cited page. Redirects are followed by hand rather than by the
 * runtime: `redirect: "follow"` would let a public URL bounce the server into
 * a private address, which is the whole failure this guard exists to prevent.
 * The timeout spans every hop, so redirect chains can't extend the budget.
 */
async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isPubliclyFetchable(current)) return null;
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location === null) return null;
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html")) return null;
      const html = await res.text();
      return { html, finalUrl: current };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Page = { html: string; finalUrl: string };

/** The image a single already-fetched page may contribute to a named product. */
function imageFromPage(page: Page, tokens: readonly string[]): string | null {
  if (!pageMatchesProduct(page.html, tokens)) return null;
  return (
    extractJsonLdProductImage(page.html, page.finalUrl) ??
    extractOgImage(page.html, page.finalUrl)
  );
}

/**
 * First trustworthy image across candidate URLs: the page must mention the
 * product by name, then Product JSON-LD wins over og:image.
 *
 * Fetches run concurrently but the *result* is still the highest-priority URL
 * that yielded an image — order expresses trust, concurrency only buys time.
 */
export async function harvestImage(
  allUrls: readonly string[],
  productName: string,
  load: (url: string) => Promise<Page | null> = fetchPage,
): Promise<string | null> {
  const tokens = nameTokens(productName);
  if (tokens.length === 0) return null;
  const pages = await Promise.all(candidateUrls(allUrls).map((url) => load(url)));
  for (const page of pages) {
    if (page === null) continue;
    const image = imageFromPage(page, tokens);
    if (image !== null) return image;
  }
  return null;
}

export type ImageTask = {
  readonly key: string;
  readonly name: string;
  readonly urls: readonly string[];
};

/** What a harvest run actually achieved. Reported, never inferred from a glance. */
export type HarvestOutcome = {
  readonly attempted: number;
  readonly hit: number;
};

/**
 * Turns a harvest result into the numbers the digest reports. Pure, so the
 * metric that gates future work on this file can itself be tested.
 */
export function summarizeHarvest(results: Record<string, string | null>): HarvestOutcome {
  const values = Object.values(results);
  return {
    attempted: values.length,
    hit: values.filter((v) => v !== null).length,
  };
}

/**
 * Resolves images for several picks concurrently under one overall budget.
 * Returns key → imageUrl (null on miss/timeout). Never throws.
 *
 * Picks share one page cache: the best fit and its alternatives are usually
 * cited by overlapping pages, and a roundup review fetched once can name
 * several of them. Without it, widening the candidate list would multiply
 * identical requests instead of finding more images.
 */
export async function harvestImages(
  tasks: readonly ImageTask[],
  totalBudgetMs: number,
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  for (const task of tasks) results[task.key] = null;

  const cache = new Map<string, Promise<Page | null>>();
  const load = (url: string): Promise<Page | null> => {
    const cached = cache.get(url);
    if (cached !== undefined) return cached;
    const pending = fetchPage(url);
    cache.set(url, pending);
    return pending;
  };

  const work = Promise.allSettled(
    tasks.map(async (task) => {
      results[task.key] = await harvestImage(task.urls, task.name, load);
    }),
  );
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, totalBudgetMs))]);
  return { ...results };
}
