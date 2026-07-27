import { nanoid } from "nanoid";
import { PriceWatchSchema, type CreatePriceWatchRequest, type PriceWatch } from "../../shared/priceWatch";
import { getDb } from "../db";

/**
 * Price-watch persistence (M4 growth). Honest framing per docs/GROWTH.md — a
 * watch is a saved re-check the user can return to, NEVER a promised alert and
 * NEVER a source of purchase pressure. Delivery is out of V1 scope; we only
 * RECORD the intent, keyed to an anonymous deviceId.
 *
 * Reuses the shared SQLite connection from ../db so the schema block there stays
 * focused on core reports/telemetry.
 */

let tableReady = false;

function ensureTable(): void {
  if (tableReady) {
    return;
  }
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS price_watches (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      pick_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (report_id, rank, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_price_watches_device ON price_watches (device_id, created_at DESC);
  `);
  tableReady = true;
}

interface PriceWatchRow {
  id: string;
  report_id: string;
  rank: number;
  pick_name: string;
  created_at: string;
}

function rowToWatch(row: PriceWatchRow): PriceWatch {
  return PriceWatchSchema.parse({
    id: row.id,
    reportId: row.report_id,
    rank: row.rank,
    pickName: row.pick_name,
    createdAt: row.created_at,
  });
}

/**
 * Records a price watch. Idempotent: setting the same device+report+rank twice
 * returns the existing row rather than creating a duplicate, so a double tap or
 * a retry never inflates anything.
 */
export function createWatch(req: CreatePriceWatchRequest): PriceWatch {
  ensureTable();
  const db = getDb();

  const existing = db
    .prepare<[string, number, string], PriceWatchRow>(
      `SELECT id, report_id, rank, pick_name, created_at
       FROM price_watches WHERE report_id = ? AND rank = ? AND device_id = ?`,
    )
    .get(req.reportId, req.rank, req.deviceId);
  if (existing) {
    return rowToWatch(existing);
  }

  const id = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO price_watches (id, report_id, rank, pick_name, device_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, req.reportId, req.rank, req.pickName, req.deviceId, createdAt);

  return PriceWatchSchema.parse({
    id,
    reportId: req.reportId,
    rank: req.rank,
    pickName: req.pickName,
    createdAt,
  });
}

/** Lists a device's saved price watches, newest first. Anonymous key only. */
export function listWatches(deviceId: string): PriceWatch[] {
  ensureTable();
  const rows = getDb()
    .prepare<[string], PriceWatchRow>(
      `SELECT id, report_id, rank, pick_name, created_at
       FROM price_watches WHERE device_id = ? ORDER BY created_at DESC`,
    )
    .all(deviceId);
  return rows.map(rowToWatch);
}
