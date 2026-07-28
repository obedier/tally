/**
 * Renders the iOS app icon and launch image from the brand mark, reproducibly.
 *
 * The mark is the spyglass already used on the share cards (src/server/og/card.ts)
 * with Tally's tally strokes inside the lens — search plus a tallied verdict,
 * which is the product in one shape. It is drawn large and high-contrast so it
 * survives being 60px on a Home Screen.
 *
 * Both outputs replace Capacitor's scaffolding defaults, which otherwise ship
 * the Capacitor logo as the first thing a user ever sees.
 *
 * The icon is deliberately opaque RGB with no alpha channel: iOS silently drops
 * app icons that carry transparency. See the iOS standards in CLAUDE.md.
 *
 * Usage: npx tsx scripts/generate-ios-art.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ICON_SIZE = 1024;
const SPLASH_SIZE = 2732;

/** Brand tokens, mirrored from src/client/styles/tokens.css. */
const PAPER = "#fbfaf7";
const GREEN = "#12543b";
const GREEN_DEEP = "#071c14";
const ORANGE = "#d94d18";

const ASSETS = resolve(import.meta.dirname, "../ios/App/App/Assets.xcassets");
const OUT_ICON = `${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`;
const OUT_SPLASHES = [
  `${ASSETS}/Splash.imageset/splash-2732x2732.png`,
  `${ASSETS}/Splash.imageset/splash-2732x2732-1.png`,
  `${ASSETS}/Splash.imageset/splash-2732x2732-2.png`,
];

/**
 * The mark, drawn in a 1024 space and visually centred on (512, 512).
 * `strokeColor` is the spyglass and the counted strokes; the fourth stroke is
 * always the accent, so the mark reads as "these were counted, this is the one".
 */
function markGroup(strokeColor: string): string {
  return `<g transform="translate(-6,9)" fill="none" stroke-linecap="round">
    <!-- Four tally strokes inside the lens: candidates counted, one picked.
         Deliberately no diagonal strike-through — at icon size that reads as a
         prohibition sign, the opposite of what a verdict means. -->
    <g stroke="${strokeColor}" stroke-width="32">
      <line x1="386" y1="345" x2="386" y2="565"/>
      <line x1="442" y1="345" x2="442" y2="565"/>
      <line x1="498" y1="345" x2="498" y2="565"/>
    </g>
    <line x1="554" y1="345" x2="554" y2="565" stroke="${ORANGE}" stroke-width="32"/>
    <!-- Spyglass: lens ring then handle, drawn over the strokes. -->
    <circle cx="470" cy="455" r="250" stroke="${strokeColor}" stroke-width="44"/>
    <line x1="647" y1="632" x2="810" y2="795" stroke="${strokeColor}" stroke-width="56"/>
  </g>`;
}

function iconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${GREEN}"/>
      <stop offset="100%" stop-color="${GREEN_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="url(#ground)"/>
  ${markGroup(PAPER)}
</svg>`;
}

/**
 * Launch image: the mark small and quiet on the app's own paper ground, so the
 * hand-off from launch screen to first paint is invisible rather than a flash.
 */
function splashSvg(): string {
  const scale = 0.34;
  const offset = SPLASH_SIZE / 2 - 512 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPLASH_SIZE}" height="${SPLASH_SIZE}" viewBox="0 0 ${SPLASH_SIZE} ${SPLASH_SIZE}">
  <rect width="${SPLASH_SIZE}" height="${SPLASH_SIZE}" fill="${PAPER}"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">
    ${markGroup(GREEN)}
  </g>
</svg>`;
}

async function render(svg: string, size: number, out: string): Promise<void> {
  const { Resvg } = await import("@resvg/resvg-js");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
}

/**
 * Flatten to opaque RGB. resvg always emits RGBA, and an icon carrying an alpha
 * channel is the single most common reason an iOS app ships a blank tile.
 */
function flatten(path: string, background: string): void {
  const rgb = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
  execFileSync("python3", [
    "-c",
    [
      "import sys;from PIL import Image",
      "p=sys.argv[1];bgcolor=tuple(int(v) for v in sys.argv[2].split(','))",
      "im=Image.open(p)",
      "bg=Image.new('RGB',im.size,bgcolor)",
      "bg.paste(im,mask=im.split()[3] if im.mode=='RGBA' else None)",
      "bg.save(p,'PNG')",
      "assert Image.open(p).mode=='RGB'",
    ].join("\n"),
    path,
    rgb.join(","),
  ]);
}

async function main(): Promise<void> {
  await render(iconSvg(), ICON_SIZE, OUT_ICON);
  flatten(OUT_ICON, GREEN_DEEP);

  const [primarySplash, ...copies] = OUT_SPLASHES;
  if (!primarySplash) throw new Error("No splash output configured");
  await render(splashSvg(), SPLASH_SIZE, primarySplash);
  flatten(primarySplash, PAPER);
  for (const copy of copies) {
    await render(splashSvg(), SPLASH_SIZE, copy);
    flatten(copy, PAPER);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote app icon (${ICON_SIZE}px) and ${OUT_SPLASHES.length} launch images.`);
}

void main();
