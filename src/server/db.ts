import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { isGtin } from "../shared/gtin";
import { ReportSchema, type Report } from "../shared/report";
import { TelemetryEventSchema } from "../shared/telemetry";

/**
 * Server-side persistence: reports + telemetry, per docs/LEARNING.md.
 * Privacy rule (non-negotiable): invalid telemetry payloads are counted in
 * `rejected_events` with a reason only — the raw payload is NEVER stored.
 */

const DEFAULT_DB_PATH = "data/tally.db";
const LIST_REPORTS_CAP = 50;

/** Envelope keys are format-constrained by schema; the PII guard scans body props only. */
const ENVELOPE_KEYS = new Set(["eventId", "sessionId", "deviceId", "ts"]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** 10+ digits allowing at most one common separator between digits (phone-like). */
const PHONE_PATTERN = /(?:\d[\s\-.()]?){9,}\d/;

let db: Database.Database | null = null;

/**
 * Shared SQLite connection. Exported so per-domain persistence modules
 * (db/polls.ts, db/priceWatch.ts) reuse the same connection and create their
 * own tables, keeping this file's schema block focused on core reports/events.
 */
export function getDb(): Database.Database {
  if (db) {
    return db;
  }
  const dbPath = resolve(process.env.TALLY_DB_PATH ?? DEFAULT_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const connection = new Database(dbPath);
  connection.pragma("journal_mode = WAL");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      created_at TEXT NOT NULL,
      verdict_headline TEXT NOT NULL,
      category TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telemetry_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      session_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      received_at TEXT NOT NULL,
      props TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rejected_events (
      id TEXT PRIMARY KEY,
      reason TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_telemetry_events_name ON telemetry_events (name);
  `);
  db = connection;
  return connection;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function saveReport(report: Report): void {
  const validated = ReportSchema.parse(report);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO reports (id, query, created_at, verdict_headline, category, json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      validated.id,
      validated.query,
      validated.createdAt,
      validated.verdict.headline,
      validated.category.id,
      JSON.stringify(validated),
    );
}

export function getReport(id: string): Report | null {
  const row = getDb()
    .prepare<[string], { json: string }>("SELECT json FROM reports WHERE id = ?")
    .get(id);
  if (!row) {
    return null;
  }
  return ReportSchema.parse(JSON.parse(row.json));
}

interface ReportListRow {
  id: string;
  query: string;
  created_at: string;
  verdict_headline: string;
  category: string;
}

export function listReports(): {
  id: string;
  query: string;
  createdAt: string;
  verdictHeadline: string;
  category: string;
}[] {
  const rows = getDb()
    .prepare<[number], ReportListRow>(
      `SELECT id, query, created_at, verdict_headline, category
       FROM reports ORDER BY created_at DESC LIMIT ?`,
    )
    .all(LIST_REPORTS_CAP);
  return rows.map((row) => ({
    id: row.id,
    query: row.query,
    createdAt: row.created_at,
    verdictHeadline: row.verdict_headline,
    category: row.category,
  }));
}

export function deleteReport(id: string): boolean {
  const result = getDb().prepare("DELETE FROM reports WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

function containsPiiLikeText(value: string): boolean {
  return EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value);
}

/**
 * The one exemption to the phone heuristic: a scanned product barcode.
 *
 * A UPC/EAN is 12–14 digits, so PHONE_PATTERN (10+ digits) matches every one of
 * them — barcode searches were rejected wholesale as suspected phone numbers,
 * which would leave the scan feature with no telemetry at all. The exemption is
 * kept as narrow as it can be: the search query, alone on the field, with a
 * valid GTIN check digit (validated by the same shared function the scanner
 * uses). The residual exposure is a 12–14-digit phone number that also happens
 * to satisfy a GTIN checksum — roughly a 1-in-10 coincidence on top of an
 * already-implausible one, and never a number formatted the way people write
 * phone numbers.
 */
function isScannedProductCode(eventName: unknown, key: string, value: string): boolean {
  return eventName === "search_started" && key === "query" && isGtin(value.trim());
}

/**
 * Lightweight PII guard over free-text body props (envelope excluded — those
 * are already format-constrained by schema). `query` on search_started is
 * allowed text per docs/LEARNING.md but still runs this guard.
 */
function findPiiInBodyProps(event: Record<string, unknown>): boolean {
  return Object.entries(event).some(
    ([key, value]) =>
      !ENVELOPE_KEYS.has(key) &&
      typeof value === "string" &&
      !isScannedProductCode(event.name, key, value) &&
      containsPiiLikeText(value),
  );
}

function recordRejection(reason: string): void {
  getDb()
    .prepare("INSERT INTO rejected_events (id, reason, received_at) VALUES (?, ?, ?)")
    .run(nanoid(), reason, new Date().toISOString());
}

/** Validates one event; stores it or counts a rejection (never the raw payload). */
function ingestEvent(event: unknown): "accepted" | "rejected" {
  const parsed = TelemetryEventSchema.safeParse(event);
  if (!parsed.success) {
    recordRejection("schema-invalid");
    return "rejected";
  }
  const validated = parsed.data as Record<string, unknown> & typeof parsed.data;
  if (findPiiInBodyProps(validated)) {
    recordRejection("pii-suspected");
    return "rejected";
  }
  const props = Object.fromEntries(
    Object.entries(validated).filter(([key]) => !ENVELOPE_KEYS.has(key) && key !== "name"),
  );
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO telemetry_events (id, name, session_id, device_id, ts, received_at, props)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      validated.eventId,
      validated.name,
      validated.sessionId,
      validated.deviceId,
      validated.ts,
      new Date().toISOString(),
      JSON.stringify(props),
    );
  // A duplicate eventId is ignored by the DB; report it truthfully instead of
  // counting it as accepted (idempotent retries are fine, inflated counts are not).
  if (result.changes === 0) {
    recordRejection("duplicate-event-id");
    return "rejected";
  }
  return "accepted";
}

export function saveServerEvent(event: object): void {
  ingestEvent(event);
}

export function saveClientEvents(events: unknown[]): { accepted: number; rejected: number } {
  return events.reduce<{ accepted: number; rejected: number }>(
    (tally, event) =>
      ingestEvent(event) === "accepted"
        ? { ...tally, accepted: tally.accepted + 1 }
        : { ...tally, rejected: tally.rejected + 1 },
    { accepted: 0, rejected: 0 },
  );
}

export function getEventCounts(): { name: string; count: number }[] {
  return getDb()
    .prepare<[], { name: string; count: number }>(
      "SELECT name, COUNT(*) as count FROM telemetry_events GROUP BY name ORDER BY count DESC, name ASC",
    )
    .all();
}
