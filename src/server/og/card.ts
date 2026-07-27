import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Report } from "../../shared/report";

/**
 * Open Graph card generator (docs/GROWTH.md): a 1200×630 social card carrying
 * the editorial Tally identity — serif verdict headline, best-fit pick + price,
 * confidence, wordmark, "Researched by Tally". The card alone is worth a
 * screenshot and must be recognizable at thumbnail size.
 *
 * The SVG is hand-authored, converted to PNG with @resvg/resvg-js (prebuilt
 * binaries, darwin-arm64), and cached in-memory per report id. All text is
 * escaped before it enters the SVG.
 */

const WIDTH = 1200;
const HEIGHT = 630;
const ATTRIBUTION = "Researched by Tally";

// Palette (mirrors src/client/styles/tokens.css — kept literal so the server has
// no dependency on client CSS).
const PAPER = "#fbfaf7";
const INK = "#171c1b";
const GREEN = "#12543b";
const GREEN_DEEP = "#0b2b20";
const ORANGE = "#d94d18";
const MUTED = "#6e746e";
const LINE = "#dedbd3";

const cache = new Map<string, Buffer>();

/** Resolve a bundled font file path, or null if the package isn't present. */
function fontPath(pkg: string, file: string): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${pkg}/package.json`);
    const candidate = join(dirname(pkgJson), "files", file);
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function fontFiles(): string[] {
  return [
    fontPath("@fontsource/playfair-display", "playfair-display-latin-700-normal.woff2"),
    fontPath("@fontsource/playfair-display", "playfair-display-latin-400-normal.woff2"),
    fontPath("@fontsource/dm-sans", "dm-sans-latin-600-normal.woff2"),
    fontPath("@fontsource/dm-sans", "dm-sans-latin-400-normal.woff2"),
  ].filter((p): p is string => p !== null);
}

/** Escape text for use inside SVG text nodes. */
function escSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Greedy word-wrap into at most `maxLines` lines of ~`maxChars` each; the last
 * line is ellipsized when text overflows. Char-count based (no font metrics) —
 * good enough for a fixed-size card with a conservative width budget.
 */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) {
        lines.push(current);
      }
      current = word;
      if (lines.length === maxLines - 1) {
        break;
      }
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const last = lines[lines.length - 1];
  if (consumed < words.length && last !== undefined) {
    lines[lines.length - 1] =
      last.length > maxChars - 1 ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
  }
  return lines;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

/** Hand-authored 1200×630 SVG carrying the editorial identity. */
export function buildOgSvg(report: Report): string {
  const headlineLines = wrap(report.verdict.headline, 30, 3);
  const bestName = report.bestFit.name;
  const bestPrice = report.bestFit.priceRange.display;
  const confidence = CONFIDENCE_LABEL[report.verdict.confidence] ?? report.verdict.confidence;

  const headlineY = 250;
  const lineHeight = 82;
  const headlineTspans = headlineLines
    .map(
      (line, i) =>
        `<text x="80" y="${headlineY + i * lineHeight}" font-family="Playfair Display, Georgia, serif" font-size="68" font-weight="700" fill="${GREEN_DEEP}">${escSvg(
          line,
        )}</text>`,
    )
    .join("");

  // One memorable tradeoff (GROWTH.md OG spec): the single most decisive factor.
  const tradeoff = wrap(report.verdict.decisiveFactors[0] ?? "", 62, 1)[0] ?? "";
  const tradeoffText = tradeoff
    ? `<text x="80" y="452" font-family="DM Sans, sans-serif" font-size="27" font-style="italic" fill="${INK}">${escSvg(
        tradeoff,
      )}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="14" height="${HEIGHT}" fill="${GREEN}"/>
  <rect x="0" y="0" width="14" height="${Math.round(HEIGHT / 3)}" fill="${ORANGE}"/>

  <!-- Wordmark: spyglass + serif Tally -->
  <g transform="translate(80,80)">
    <circle cx="16" cy="16" r="13" fill="none" stroke="${GREEN}" stroke-width="3.5"/>
    <line x1="25.5" y1="25.5" x2="38" y2="38" stroke="${GREEN}" stroke-width="3.5" stroke-linecap="round"/>
    <text x="52" y="30" font-family="Playfair Display, Georgia, serif" font-size="38" font-weight="700" fill="${GREEN_DEEP}">Tally</text>
    <line x1="168" y1="6" x2="168" y2="34" stroke="${LINE}" stroke-width="2"/>
    <text x="184" y="29" font-family="DM Sans, sans-serif" font-size="22" fill="${MUTED}">Deep product research.</text>
  </g>

  ${headlineTspans}
  ${tradeoffText}

  <!-- Best fit + price -->
  <text x="80" y="486" font-family="DM Sans, sans-serif" font-size="22" font-weight="600" fill="${ORANGE}" letter-spacing="2">BEST FIT</text>
  <text x="80" y="530" font-family="Playfair Display, Georgia, serif" font-size="40" font-weight="700" fill="${INK}">${escSvg(
    wrap(bestName, 40, 1)[0] ?? "",
  )}</text>
  <text x="80" y="568" font-family="DM Sans, sans-serif" font-size="26" font-weight="600" fill="${GREEN}">${escSvg(
    bestPrice,
  )}   ·   ${escSvg(confidence)}</text>

  <!-- Attribution -->
  <line x1="80" y1="600" x2="${WIDTH - 80}" y2="600" stroke="${LINE}" stroke-width="1.5"/>
  <text x="${WIDTH - 80}" y="588" text-anchor="end" font-family="DM Sans, sans-serif" font-size="22" font-weight="600" fill="${MUTED}">${ATTRIBUTION}</text>
</svg>`;
}

/**
 * Render the OG PNG for a report, cached by report id.
 * @param report the stable, validated report contract
 * @returns a PNG Buffer (1200×630)
 */
export async function renderOgPng(report: Report): Promise<Buffer> {
  const cached = cache.get(report.id);
  if (cached) {
    return cached;
  }
  const svg = buildOgSvg(report);
  // Dynamic import so a resvg load failure is caught here and can fall back,
  // rather than crashing module load for the whole server.
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    background: PAPER,
    fitTo: { mode: "width", value: WIDTH },
    font: {
      fontFiles: fontFiles(),
      loadSystemFonts: true,
      defaultFontFamily: "DM Sans",
      serifFamily: "Playfair Display",
    },
  });
  const png = resvg.render().asPng();
  cache.set(report.id, png);
  return png;
}

/** Test/introspection helper: current cache size. */
export function ogCacheSize(): number {
  return cache.size;
}
