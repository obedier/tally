import type { CategoryId, Report, ResearchMode } from "../../shared/report";
import { getDb } from "../db";

/**
 * Category-aware result cache (M5 gate 3), per docs/LEARNING.md ("Category
 * cache" — slow-moving category knowledge cached with explicit freshness
 * windows, refreshed by real traffic).
 *
 * HONESTY (CLAUDE.md non-negotiable — no fabricated live data): a cache hit
 * returns a previously-researched report UNCHANGED. It carries its real
 * research date (`report.createdAt`), which the UI already shows, so a reused
 * report is never relabelled as freshly fetched "now". Freshness is measured
 * against that real research date — never against when it was cached — so a
 * report is only served while its ACTUAL research is still within window.
 *
 * Freshness windows are per-category because staleness cost differs: prices and
 * models move fastest for electronics, so its window is the shortest.
 */

/** Per-category freshness windows in ms. Short where prices/models move fast. */
const HOUR_MS = 60 * 60 * 1000;
export const FRESHNESS_WINDOWS_MS: Record<CategoryId, number> = {
  // Prices and generations churn fastest here — keep it tight.
  "consumer-electronics": 24 * HOUR_MS,
  // Slow-moving catalogs, steep-but-infrequent discount cycles.
  "home-goods": 72 * HOUR_MS,
  // Mixed bag; a middle-of-the-road default.
  other: 48 * HOUR_MS,
};

/**
 * Modes whose reports are worth reusing. Quick reports are deliberately NOT
 * cached: they are cheap to regenerate and the most volatile (fewest sources,
 * thinnest price evidence), so reusing one buys little and risks serving the
 * weakest report class. Full/deep reports cost real Gemini spend and carry
 * enough evidence to be worth reusing within their window.
 */
const CACHEABLE_MODES: ReadonlySet<ResearchMode> = new Set<ResearchMode>(["full", "deep"]);

let tableReady = false;

/** Idempotent schema bootstrap; runs once per process on first cache operation. */
function ensureTable(): ReturnType<typeof getDb> {
  const db = getDb();
  if (tableReady) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_cache (
      cache_key TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      report_created_at TEXT NOT NULL,
      remembered_at TEXT NOT NULL
    );
  `);
  tableReady = true;
  return db;
}

/**
 * Normalizes a raw query to a stable cache token: lowercased, punctuation
 * stripped to spaces, whitespace collapsed, trimmed. Both `remember` and
 * `lookupFresh` run identical normalization, so "Sony WH-1000XM5!" and
 * "sony  wh 1000xm5" collapse to the same key. Pure.
 */
function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The cache key for a query+mode+location scope. Location-scoped reports carry
 * local retailers for a specific place, so a report researched for one place is
 * never served for another; runs with no known location share the "anywhere"
 * scope. Pure.
 */
export function cacheKey(query: string, mode: ResearchMode, locationLabel?: string): string {
  const scope =
    locationLabel === undefined || normalizeQuery(locationLabel) === ""
      ? "anywhere"
      : normalizeQuery(locationLabel);
  return `${normalizeQuery(query)}::${mode}::${scope}`;
}

/**
 * Whether a report researched at `createdAtIso` is still fresh for `categoryId`
 * relative to `nowMs`. Pure and injectable — `nowMs` is passed in, never read
 * from the clock here, so the freshness boundary is deterministically testable.
 * A createdAt in the future (clock skew) or unparseable date is treated as
 * not-fresh rather than trusted.
 */
export function isFresh(createdAtIso: string, categoryId: CategoryId, nowMs: number): boolean {
  const createdMs = Date.parse(createdAtIso);
  if (Number.isNaN(createdMs)) return false;
  const ageMs = nowMs - createdMs;
  if (ageMs < 0) return false;
  return ageMs < FRESHNESS_WINDOWS_MS[categoryId];
}

interface CacheRow {
  report_id: string;
  category_id: CategoryId;
  report_created_at: string;
}

/**
 * Returns the cached reportId for this query+mode ONLY if the stored report's
 * real research date is within its category's freshness window at `nowMs`;
 * otherwise null. `nowMs` is injected for deterministic tests. The caller is
 * responsible for loading (and honestly presenting) the report by id.
 */
export function lookupFresh(
  query: string,
  mode: ResearchMode,
  nowMs: number,
  locationLabel?: string,
): { reportId: string } | null {
  if (!CACHEABLE_MODES.has(mode)) return null;
  const db = ensureTable();
  const row = db
    .prepare<[string], CacheRow>(
      "SELECT report_id, category_id, report_created_at FROM query_cache WHERE cache_key = ?",
    )
    .get(cacheKey(query, mode, locationLabel));
  if (!row) return null;
  if (!isFresh(row.report_created_at, row.category_id, nowMs)) return null;
  return { reportId: row.report_id };
}

/**
 * Records a completed report under its query+mode key so a later identical
 * query can reuse it while fresh. Quick-mode reports are intentionally skipped
 * (see CACHEABLE_MODES). Stores the report's REAL createdAt so freshness is
 * always judged against actual research time. Latest write wins the key.
 */
export function remember(
  query: string,
  mode: ResearchMode,
  report: Report,
  locationLabel?: string,
): void {
  if (!CACHEABLE_MODES.has(mode)) return;
  const db = ensureTable();
  db.prepare(
    `INSERT INTO query_cache (cache_key, report_id, category_id, report_created_at, remembered_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (cache_key)
     DO UPDATE SET report_id = excluded.report_id,
                   category_id = excluded.category_id,
                   report_created_at = excluded.report_created_at,
                   remembered_at = excluded.remembered_at`,
  ).run(
    cacheKey(query, mode, locationLabel),
    report.id,
    report.category.id,
    report.createdAt,
    new Date().toISOString(),
  );
}
