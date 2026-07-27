import type { Hono } from "hono";
import { getReport } from "../db";
import { renderOgPng } from "../og/card";
import { buildNotFoundHtml, buildShareHtml } from "../share/html";

/**
 * Public share surfaces (docs/GROWTH.md):
 *  - GET /s/:id      → server-rendered editorial share HTML (no login).
 *  - GET /og/:id.png → the 1200×630 social card PNG (cached).
 *
 * Both load the stable report contract via getReport. HTML is cheap (S6: share
 * p75 ≤ 2.5s); the OG PNG is cached per report in card.ts. A missing report
 * returns honest branded output, never a stack trace.
 */

/** Absolute origin for canonical + og:image, derived from the request URL. */
function originFromRequest(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function registerShareRoutes(app: Hono): void {
  app.get("/s/:id", (c) => {
    const report = getReport(c.req.param("id"));
    if (!report) {
      return c.html(buildNotFoundHtml(), 404);
    }
    const origin = originFromRequest(c.req.url);
    return c.html(buildShareHtml(report, origin));
  });

  // `:id{.+\.png}` captures the id WITH its .png suffix (a bare `/og/:id.png`
  // pattern matches but leaves the `id` param undefined in Hono's router); we
  // strip the extension below. Route reads as GET /og/:id.png for callers.
  app.get("/og/:id{.+\\.png}", async (c) => {
    const id = (c.req.param("id") ?? "").replace(/\.png$/, "");
    const report = getReport(id);
    if (!report) {
      return c.text("Not found", 404);
    }
    try {
      const png = await renderOgPng(report);
      // Copy into a fresh Uint8Array so the type is ArrayBuffer-backed (Hono's
      // body type rejects a possibly-SharedArrayBuffer-backed Node Buffer).
      const bytes = new Uint8Array(png);
      return c.body(bytes, 200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
      });
    } catch {
      // OG rendering must never take down the share page; the HTML degrades
      // gracefully without a card. Report the failure honestly to the caller.
      return c.text("Card unavailable", 500);
    }
  });
}
