import { serve } from "@hono/node-server";
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

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Tally server listening on http://127.0.0.1:${info.port}`);
});
