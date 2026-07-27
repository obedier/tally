import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDigest } from "../src/server/jobs/digest";

/**
 * Thin CLI wrapper for the nightly digest job (M5, docs/LEARNING.md).
 *
 * Date resolution lives HERE (not in the pure builder): a real scheduled run
 * may compute today's date with Date, whereas buildDigest takes the date as a
 * param so it stays deterministic and testable. Pass an explicit date as the
 * first CLI arg (YYYY-MM-DD) to override; otherwise today (UTC) is used.
 *
 * Writes intelligence/digests/YYYY-MM-DD.{json,md} and refreshes
 * intelligence/latest.md — the file Claude Code reads at every session start.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolveDate(argv: string[]): string {
  const arg = argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    return arg;
  }
  return new Date().toISOString().slice(0, 10);
}

function main(): void {
  const date = resolveDate(process.argv);
  const { json, markdown } = buildDigest({ date });

  const digestsDir = resolve(REPO_ROOT, "intelligence/digests");
  mkdirSync(digestsDir, { recursive: true });

  const jsonPath = resolve(digestsDir, `${date}.json`);
  const mdPath = resolve(digestsDir, `${date}.md`);
  const latestPath = resolve(REPO_ROOT, "intelligence/latest.md");

  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  writeFileSync(mdPath, markdown, "utf8");
  copyFileSync(mdPath, latestPath);

  process.stdout.write(
    `Digest written for ${date}:\n  ${jsonPath}\n  ${mdPath}\n  ${latestPath}\n` +
      `Events aggregated: ${json.eventTotals.total}; suspected problems: ${json.suspectedProblems.length}\n`,
  );
}

main();
