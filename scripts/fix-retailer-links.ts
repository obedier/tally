/**
 * One-time fixup: apply deepRetailerUrl to already-stored reports so existing
 * retailer listings stop pointing at generic homepages. Deterministic rewrite
 * of URLs only — prices, availability, and everything else stay untouched.
 * Idempotent: re-running changes nothing once URLs are deep.
 *
 *   npx tsx scripts/fix-retailer-links.ts [path/to/tally.db]
 */
import Database from "better-sqlite3";
import { deepRetailerUrl } from "../src/server/engine/sanitize";

const dbPath = process.argv[2] ?? "data/tally.db";
const db = new Database(dbPath);

const rows = db.prepare("SELECT id, json FROM reports").all() as Array<{
  id: string;
  json: string;
}>;

const update = db.prepare("UPDATE reports SET json = ? WHERE id = ?");
let changed = 0;

for (const row of rows) {
  let report: {
    bestFit?: { name?: string };
    retailers?: Array<{ seller: string; url: string | null }>;
  };
  try {
    report = JSON.parse(row.json);
  } catch {
    continue;
  }
  const name = report.bestFit?.name ?? null;
  if (name === null || !Array.isArray(report.retailers)) continue;
  let touched = false;
  const retailers = report.retailers.map((r) => {
    const next = deepRetailerUrl(r.url, r.seller, name);
    if (next !== r.url) touched = true;
    return { ...r, url: next };
  });
  if (!touched) continue;
  update.run(JSON.stringify({ ...report, retailers }), row.id);
  changed += 1;
}

console.log(`Rewrote retailer URLs on ${changed} of ${rows.length} reports (${dbPath}).`);
