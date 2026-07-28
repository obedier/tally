import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { registerResearchRoutes } from "./routes/research";
import { registerReportRoutes } from "./routes/reports";
import { registerTelemetryRoutes } from "./routes/telemetry";
import { registerShareRoutes } from "./routes/share";
import { registerPollRoutes } from "./routes/polls";
import { registerPriceWatchRoutes } from "./routes/priceWatch";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

registerResearchRoutes(app);
registerReportRoutes(app);
registerTelemetryRoutes(app);
// M4 growth surfaces. Share/OG are server-rendered (non-/api) HTML + PNG routes
// (/s/:id, /og/:id.png); polls + price-watch are /api routes. Production SPA
// static-serving (serveStatic) lands in M6 deploy — dev serves via the Vite proxy.
registerShareRoutes(app);
registerPollRoutes(app);
registerPriceWatchRoutes(app);

// Production: this process serves the built SPA too (dev uses the Vite proxy).
// Real files first; anything else that isn't an API/share/OG route falls back
// to index.html so client-side routes survive a hard reload.
if (process.env.NODE_ENV === "production") {
  // Hashed assets are immutable; everything else (index.html, images) must
  // revalidate — a cached index.html pins users to a stale JS bundle for days.
  app.use("*", async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/")) return;
    if (c.req.path.startsWith("/assets/")) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      c.header("Cache-Control", "no-cache");
    }
  });
  app.use("*", serveStatic({ root: "./dist/client" }));
  app.get("*", (c, next) => {
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/s/") || path.startsWith("/og/")) {
      return next();
    }
    return serveStatic({ path: "./dist/client/index.html" })(c, next);
  });
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Tally server listening on http://127.0.0.1:${info.port}`);
});
