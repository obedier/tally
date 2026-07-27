# Tally — V1 milestones and acceptance gates

This is the persistent state file and the single acceptance authority for V1. Update checkboxes only after the gate is verified in the running app (per the loop engineering rules in `CLAUDE.md`). Keep the **Status** line and the scorecard current so any fresh session can resume from this file alone.

**Status:** not started — begin with M0.

## V1 scorecard — measurable targets

The measured column is filled with real numbers from the running app; "not yet measured" is the only acceptable placeholder. A milestone that owns a target cannot complete until that target is measured. A missed target requires an explicit logged decision (accept with reason, or fix) — never silence. Where infrastructure targets and product feel conflict, remember the priority order in `CLAUDE.md`.

| # | Target | Owned by | Measured | Status |
|---|--------|----------|----------|--------|
| S1 | Quick mode time-to-verdict p75 ≤ 45s; Full ≤ 4 min (real Gemini, both categories) | M2 | not yet measured | ☐ |
| S2 | First visible research activity (assumptions or plan) ≤ 3s after search; "best fit so far" ≤ 30s | M2 | not yet measured | ☐ |
| S3 | Report contract validation failure rate < 1% across the golden-query suite | M1 | not yet measured | ☐ |
| S4 | Golden-query eval pass rate ≥ 95%, evals wired to block regressing engine changes | M5 | not yet measured | ☐ |
| S5 | Every report: ≥ 8 sources, ≥ 3 source classes represented or confidence indicator says why not | M1 | not yet measured | ☐ |
| S6 | Share page p75 load ≤ 2.5s at mobile viewport; OG card renders correctly in a link-preview check | M4 | not yet measured | ☐ |
| S7 | Visitor→searcher CTA conversion instrumented end-to-end; baseline recorded from real test sessions | M4 | not yet measured | ☐ |
| S8 | Lighthouse mobile ≥ 90 (performance and accessibility) on home, report, and share pages | M6 | not yet measured | ☐ |
| S9 | 100% of shipped features emit their telemetry events (audited feature-by-feature); 0 PII findings in event samples | M5 | not yet measured | ☐ |
| S10 | Nightly digest runs green ≥ 3 consecutive days with all minimum contents present | M5 | not yet measured | ☐ |
| S11 | qa-red-team final sweep: 0 open trust violations (fabricated live data, client-reachable secrets, purchase pressure) and 0 open critical bugs | M6 | not yet measured | ☐ |
| S12 | Full-loop task success: 10/10 scripted end-to-end journeys (5 per category, mobile viewport) complete without dead ends | M6 | not yet measured | ☐ |

Milestones are sequential; within a milestone, fan out parallel builder subagents with non-overlapping file ownership per the multi-agent protocol in `CLAUDE.md`. Every milestone runs as a milestone loop (see `CLAUDE.md` loop engineering): builders → integrate → verification suite → adversarial `qa-red-team` review (plus `design-critic` for UI work) → fix → re-verify → gates → scorecard update → commit. A milestone is complete only when its gates are checked **and** its owned scorecard targets are measured.

## M0 — Audit and harvest

- [ ] Repository inspected via parallel `repo-cartographer` agents: `tally-mobile-prototype/`, `old_src/`, and the main app's infrastructure (package scripts, worker/backend, routes, existing tests, `AGENTS.md`/repo guidance).
- [ ] `.env.local` checked for `GEMINI_API_KEY` (never printed, committed, or exposed).
- [ ] Prototype (`tally-mobile-prototype/`) run and its current search flow manually tested by the lead before any changes.
- [ ] Harvest inventory written to `docs/DECISIONS.md`: what the prototype gets right; per-module keep/refactor/rewrite verdicts with one-line reasons; salvage list from `old_src/` with explicit warnings on anything unsafe to copy.
- [ ] `CLAUDE.md` **Commands** section filled in with the repo's real commands and committed.
- [ ] Baseline commit made.

## M1 — Core research loop

- [ ] Search accepts product, need, problem, or SKU; category inferred with no category-selection step.
- [ ] Multi-step Gemini workflow with Google Search grounding runs server-side per `docs/ENGINE.md`; secrets server-only.
- [ ] Structured report contract validated and sanitized server-side; frontend renders only the typed contract.
- [ ] Report leads with a verdict (named product) or ranked shortlist (need), with sources as `{ title, url }` openable from the UI and a confidence indicator.
- [ ] Reports stamped with playbook/prompt versions and per-stage timings.
- [ ] Telemetry events for search and report outcomes flowing, schema-validated, privacy rules honored.
- [ ] Initial golden-query seeds captured for both launch categories.

## M2 — Live research experience

- [ ] Research opens with inferred, editable assumptions; edits redirect research live without restarting.
- [ ] Full research plan visible: completed / in-progress / upcoming questions; user can remove and add questions before they run.
- [ ] Progress, time saved, source count, and "best fit so far" update as evidence arrives; product imagery shown during research.
- [ ] Quick, Full, and Deep Dive modes behave distinctly per `docs/ENGINE.md`; Deep Dive offered only after an initial report.
- [ ] Failure states show transparent retry, never fabricated live claims.
- [ ] Live-research telemetry (assumption edits, question edits, redirects, abandonment) flowing.

## M3 — Results depth

- [ ] Comparison page: top 10 competitors in a readable grid with reviews, price ranges, pros/cons, from real structured data.
- [ ] Price page: top online and local retailers; IP-derived location default, user-editable.
- [ ] Backup picks saved; assumptions visible and changeable from results without restarting.
- [ ] History: save, open, delete prior searches; home navigation solid.
- [ ] Category playbooks demonstrably produce category-specific questions and criteria for both launch verticals.
- [ ] Results engagement telemetry (source clicks, comparison usage, retailer clicks, saves) flowing.

## M4 — Growth loop

- [ ] Public, read-only share page per report: clean stable URL, no login, fast, editorial-grade at mobile viewport, full verdict/tradeoffs/comparison/sources, visible research date and re-run action.
- [ ] Rich social card (Open Graph) renders correctly when the link is shared.
- [ ] Verdict, comparison, and pros/cons surfaces are screenshot-legible with "Researched by Tally" attribution.
- [ ] Visitor→searcher call to action present and instrumented end to end.
- [ ] Decision polls: create from a shortlist, vote and comment without an account, evidence visible to voters.
- [ ] Price watch settable from a report; honest framing per `docs/GROWTH.md`.
- [ ] All growth surfaces instrumented per `docs/GROWTH.md`; share loop verified logged-out on mobile.

## M5 — Learning infrastructure

- [ ] Golden-query eval suite complete for both categories, passing, and wired to gate engine changes.
- [ ] Query mining implemented: user-added questions and low-confidence/thumbs-down reports feed playbook updates and new eval cases.
- [ ] Category cache with freshness windows in place.
- [ ] Nightly digest job produces `intelligence/digests/YYYY-MM-DD.{json,md}` and `intelligence/latest.md` with all minimum contents from `docs/LEARNING.md`, containing only aggregates/anonymized exemplars.
- [ ] `intelligence/actions/` pattern exercised at least once: a digest finding addressed and logged.

## M6 — Polish and hardening

- [ ] Visual direction verified against `docs/PRODUCT.md`, including exact required strings and editorial identity on share surfaces.
- [ ] Every page and primary interaction verified on mobile and desktop; keyboard accessibility; deliberate loading/empty/retry/error states everywhere.
- [ ] All scorecard rows measured; every miss carries a logged decision.
- [ ] Full acceptance sweep: build, typecheck, backend tests, browser tests, eval suite all pass; focused tests added for the product flow and share loop where missing.
- [ ] Final report written: what works, genuine external limitations, links to local preview and key source files, and which digest findings (if any) this build addressed.

## V1 definition of amazing

A stranger with a real buying decision can land on Tally, get a cited, independent, decisively explained verdict in minutes, trust it enough to act, and want to send it to the friend who asked — and every one of those sessions makes the next night's build measurably better.
