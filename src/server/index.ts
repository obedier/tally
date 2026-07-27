import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { registerResearchRoutes } from "./routes/research";
import { registerReportRoutes } from "./routes/reports";
import { registerTelemetryRoutes } from "./routes/telemetry";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

registerResearchRoutes(app);
registerReportRoutes(app);
registerTelemetryRoutes(app);

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Tally server listening on http://127.0.0.1:${info.port}`);
});
