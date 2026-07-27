import type { Hono } from "hono";
import { deleteReport, getReport, listReports } from "../db";

/** Saved-report history API. The frontend receives only the stable report contract. */

export function registerReportRoutes(app: Hono): void {
  app.get("/api/reports", (c) => c.json({ reports: listReports() }));

  app.get("/api/reports/:id", (c) => {
    const report = getReport(c.req.param("id"));
    if (!report) {
      return c.json({ ok: false, code: "not-found", message: "Report not found." }, 404);
    }
    return c.json({ report });
  });

  app.delete("/api/reports/:id", (c) => c.json({ deleted: deleteReport(c.req.param("id")) }));
}
