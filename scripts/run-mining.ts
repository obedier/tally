import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mineSignals, type MiningResult } from "../src/server/jobs/mining";

/**
 * Query-mining CLI (M5). Runs the miner over the live telemetry + reports DB and
 * writes a machine-readable + human-readable pair under intelligence/mining/,
 * mirroring how nightly digests land under intelligence/digests/ (docs/LEARNING.md).
 *
 * Usage: npm run mine [-- --since-days=N]
 * The suggestions are for human review; nothing is auto-applied to the playbook
 * or the eval suite.
 */

const OUT_DIR = resolve("intelligence/mining");

function parseSinceMs(nowMs: number): number | undefined {
  const arg = process.argv.find((a) => a.startsWith("--since-days="));
  if (!arg) return undefined;
  const days = Number(arg.split("=")[1]);
  return Number.isFinite(days) && days > 0 ? nowMs - days * 24 * 60 * 60 * 1000 : undefined;
}

function toMarkdown(result: MiningResult, dateStamp: string): string {
  const lines: string[] = [];
  lines.push(`# Query mining — ${dateStamp}`);
  lines.push("");
  lines.push(`Generated ${result.generatedAt}. Suggestions only — review before applying.`);
  lines.push("");
  lines.push(
    `Scanned ${result.totals.eventsScanned} telemetry events and ${result.totals.reportsScanned} reports ` +
      `(${result.totals.userAddedQuestionEvents} user-added-question events).`,
  );
  lines.push("");

  lines.push("## Playbook — questions to ADD");
  if (result.playbookAddCandidates.length === 0) {
    lines.push("_No frequently user-added questions in window._");
  } else {
    lines.push("| count | suggested question | examples |");
    lines.push("| ----: | ------------------ | -------- |");
    for (const c of result.playbookAddCandidates) {
      lines.push(`| ${c.count} | ${c.normalizedText} | ${c.examples.join(" · ")} |`);
    }
  }
  lines.push("");

  lines.push("## Playbook — questions to DEMOTE");
  if (result.playbookDemoteCandidates.length === 0) {
    lines.push("_No frequently removed playbook questions in window._");
  } else {
    lines.push("| removals | questionId | playbook | template |");
    lines.push("| -------: | ---------- | -------- | -------- |");
    for (const c of result.playbookDemoteCandidates) {
      lines.push(
        `| ${c.removedCount} | ${c.questionId} | ${c.playbookId} | ${c.template ?? "(unknown)"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Proposed eval cases (low-confidence + thumbs-down)");
  if (result.evalCaseCandidates.length === 0) {
    lines.push("_No low-confidence or thumbs-down reports in window._");
  } else {
    for (const c of result.evalCaseCandidates) {
      lines.push(`- **${c.id}** (${c.source}) — \`${c.query}\``);
      lines.push(
        `  - mode: ${c.mode}; expect category=${c.expect.category}, queryType=${c.expect.queryType}, ` +
          `minSources=${c.expect.minSources}, minSourceClasses=${c.expect.minSourceClasses}`,
      );
    }
    lines.push("");
    lines.push("Paste-ready `cases[]` shape for evals/golden/queries.json:");
    lines.push("");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        result.evalCaseCandidates.map((c) => ({
          id: c.id,
          query: c.query,
          mode: c.mode,
          expect: {
            category: c.expect.category,
            queryType: c.expect.queryType,
            minSources: c.expect.minSources,
            minSourceClasses: c.expect.minSourceClasses,
            assumptionHints: c.expect.assumptionHints,
          },
        })),
        null,
        2,
      ),
    );
    lines.push("```");
  }
  lines.push("");
  return lines.join("\n");
}

function main(): void {
  const nowMs = Date.now();
  const result = mineSignals({ nowMs, sinceMs: parseSinceMs(nowMs) });
  const dateStamp = new Date(nowMs).toISOString().slice(0, 10);

  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = resolve(OUT_DIR, `${dateStamp}.json`);
  const mdPath = resolve(OUT_DIR, `${dateStamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(mdPath, toMarkdown(result, dateStamp));

  process.stdout.write(
    `Mining complete: ${result.playbookAddCandidates.length} add, ` +
      `${result.playbookDemoteCandidates.length} demote, ` +
      `${result.evalCaseCandidates.length} eval-case candidates.\n` +
      `Wrote ${jsonPath}\n      ${mdPath}\n`,
  );
}

main();
