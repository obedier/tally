/**
 * Harvests real product imagery from pages this research actually cited.
 * og:image / twitter:image only, taken from cited source and retailer URLs —
 * honest provenance, never stock, never generated. Best-effort under hard time
 * budgets: a miss is null, never a substitute image.
 */

const FETCH_TIMEOUT_MS = 3000;
const MAX_URLS_PER_PICK = 3;
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
 * A cited page only gets to contribute an image if its own title mentions the
 * product — otherwise a roundup or unrelated article ships its hero image as
 * "the product" (a live report showed a Dutch oven on a vacuum page this way).
 */
export function pageMatchesProduct(html: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return false;
  const titles = TITLE_PATTERNS.map((p) => html.match(p)?.[1] ?? "").join(" ").toLowerCase();
  if (titles.trim() === "") return false;
  return tokens.some((t) => titles.includes(t));
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
      if (isLikelyGenericImage(asString)) continue;
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
      if (isLikelyGenericImage(asString)) continue;
      return asString;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    const html = await res.text();
    return { html, finalUrl: res.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * First trustworthy image across candidate URLs (sequential, capped): the page
 * must mention the product by name, then Product JSON-LD wins over og:image.
 */
export async function harvestImage(
  allUrls: readonly string[],
  productName: string,
): Promise<string | null> {
  const tokens = nameTokens(productName);
  const urls = allUrls.filter((u) => !isRootUrl(u));
  for (const url of urls.slice(0, MAX_URLS_PER_PICK)) {
    const page = await fetchPage(url);
    if (page === null) continue;
    if (!pageMatchesProduct(page.html, tokens)) continue;
    const image =
      extractJsonLdProductImage(page.html, page.finalUrl) ??
      extractOgImage(page.html, page.finalUrl);
    if (image !== null) return image;
  }
  return null;
}

export type ImageTask = {
  readonly key: string;
  readonly name: string;
  readonly urls: readonly string[];
};

/**
 * Resolves images for several picks concurrently under one overall budget.
 * Returns key → imageUrl (null on miss/timeout). Never throws.
 */
export async function harvestImages(
  tasks: readonly ImageTask[],
  totalBudgetMs: number,
): Promise<Record<string, string | null>> {
  const results: Record<string, string | null> = {};
  for (const task of tasks) results[task.key] = null;
  const work = Promise.allSettled(
    tasks.map(async (task) => {
      const image = await harvestImage(task.urls, task.name);
      results[task.key] = image;
    }),
  );
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, totalBudgetMs))]);
  return { ...results };
}
