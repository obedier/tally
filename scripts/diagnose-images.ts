/**
 * Explains, per URL, why a report did or didn't get a product image.
 *
 * Image misses are otherwise silent — the report just has no picture and there
 * is nothing to read. This walks the same URLs the harvester would, and prints
 * the stage each one died at: fetch, title match, or extraction.
 *
 * Usage: npx tsx scripts/diagnose-images.ts <reportId> [--base https://tally.o11r.com]
 */
import {
  extractJsonLdProductImage,
  extractOgImage,
  isRootUrl,
  nameTokens,
  pageMatchesProduct,
} from "../src/server/engine/images";

const PROBE_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function probe(url: string, tokens: readonly string[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) return `HTTP ${res.status} (final ${hostOf(res.url)})`;
    if (!contentType.includes("html")) return `non-html (${contentType})`;
    const html = await res.text();
    const matched = pageMatchesProduct(html, tokens);
    const jsonLd = extractJsonLdProductImage(html, res.url);
    const og = extractOgImage(html, res.url);
    const picked = jsonLd ?? og;
    const verdict = !matched
      ? "REJECTED (title does not mention the product)"
      : picked === null
        ? "REJECTED (no og:image or Product JSON-LD)"
        : `ACCEPTED ${picked.slice(0, 70)}`;
    return `final=${hostOf(res.url)} jsonld=${jsonLd ? "Y" : "n"} og=${og ? "Y" : "n"} — ${verdict}`;
  } catch (error) {
    return `FETCH FAILED (${(error as Error).name})`;
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

async function main(): Promise<void> {
  const [reportId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex === -1 ? "https://tally.o11r.com" : (process.argv[baseIndex + 1] ?? "");
  if (!reportId) throw new Error("Usage: npx tsx scripts/diagnose-images.ts <reportId>");

  const res = await fetch(`${base}/api/reports/${reportId}`);
  if (!res.ok) throw new Error(`Report ${reportId} not found (${res.status})`);
  const body = (await res.json()) as Record<string, unknown>;
  const report = (body["report"] ?? body) as Record<string, unknown>;
  const bestFit = report["bestFit"] as { name: string; imageUrl?: string | null };
  const tokens = nameTokens(bestFit.name);

  /* eslint-disable no-console */
  console.log(`report=${reportId}  bestFit="${bestFit.name}"`);
  console.log(`match tokens: ${JSON.stringify(tokens)}`);
  console.log(`stored image: ${bestFit.imageUrl ?? "NONE"}\n`);

  const retailers = (report["retailers"] ?? []) as { url: string; seller?: string }[];
  console.log(`-- retailers (${retailers.length}) --`);
  for (const r of retailers.slice(0, 6)) {
    console.log(`${isRootUrl(r.url) ? "[root] " : "       "}${r.seller ?? ""} ${r.url.slice(0, 78)}`);
    console.log(`         ${await probe(r.url, tokens)}`);
  }

  const sources = (report["sources"] ?? []) as { url: string; domain?: string }[];
  console.log(`\n-- sources (${sources.length}) --`);
  for (const [i, s] of sources.slice(0, 8).entries()) {
    console.log(`  s${i + 1} ${s.domain ?? hostOf(s.url)}`);
    console.log(`         ${await probe(s.url, tokens)}`);
  }
  /* eslint-enable no-console */
}

void main();
