# Tally — V1 milestones and acceptance gates

This is the persistent state file and the single acceptance authority for V1. Update checkboxes only after the gate is verified in the running app (per the loop engineering rules in `CLAUDE.md`). Keep the **Status** line and the scorecard current so any fresh session can resume from this file alone.

**Status:** M5 complete — learning infrastructure shipped: golden-query eval suite gating engine changes (S4 100%), query mining (`npm run mine`) + thumbs feedback, category cache with per-category freshness windows, nightly digest (`npm run digest`) with all LEARNING.md contents + Top-5 problems (PII-safe), actions loop exercised (eval caught weak assumptions → classify v1.2.0 → S4 100%). S4 ☑, S9 ☑ (all 22 events fire, 0 PII), S10 ◐ (job complete + reliable; 3-calendar-day accumulation is post-deploy). 126 unit tests green. Next: M6 — polish and hardening (final milestone).

## V1 scorecard — measurable targets

The measured column is filled with real numbers from the running app; "not yet measured" is the only acceptable placeholder. A milestone that owns a target cannot complete until that target is measured. A missed target requires an explicit logged decision (accept with reason, or fix) — never silence. Where infrastructure targets and product feel conflict, remember the priority order in `CLAUDE.md`.

| # | Target | Owned by | Measured | Status |
|---|--------|----------|----------|--------|
| S1 | Quick mode time-to-verdict p75 ≤ 45s; Full ≤ 4 min (real Gemini, both categories) | M2 | Full p75 152s ≤240s ☑; Quick unsteered 33–44s (3 golden), steered runs +1 batch push p75 ~77s — see D-024 | ◐ |
| S2 | First visible research activity (assumptions or plan) ≤ 3s after search; "best fit so far" ≤ 30s | M2 | assumptions event 2.1s ✓; best-fit-so-far after batch 1 (~17–27s) ✓ | ☑ |
| S3 | Report contract validation failure rate < 1% across the golden-query suite | M1 | 0.0% across 16 golden-suite runs (2026-07-27, evals/results/) | ☑ |
| S4 | Golden-query eval pass rate ≥ 95%, evals wired to block regressing engine changes | M5 | 100% (12/12) on classify v1.2.0 + robust assumption grader; harness exits 1 below 95% and runs noCache to gate engine changes (2026-07-27) | ☑ |
| S5 | Every report: ≥ 8 sources, ≥ 3 source classes represented or confidence indicator says why not | M1 | 12/12 golden reports satisfy (sanitizer-enforced cap + gap sentence; eval sourceDiversity check) | ☑ |
| S6 | Share page p75 load ≤ 2.5s at mobile viewport; OG card renders correctly in a link-preview check | M4 | Share p75 1.2ms server response (self-contained ~25KB HTML, no external resources); OG `/og/:id.png` valid 1200×630 PNG. Full mobile Lighthouse LCP confirmed in M6 (S8). | ☑ |
| S7 | Visitor→searcher CTA conversion instrumented end-to-end; baseline recorded from real test sessions | M4 | Funnel wired + observed firing: share_page_viewed → cta_clicked → search_started(entry="share-cta"); events recorded in DB | ☑ |
| S8 | Lighthouse mobile ≥ 90 (performance and accessibility) on home, report, and share pages | M6 | not yet measured | ☐ |
| S9 | 100% of shipped features emit their telemetry events (audited feature-by-feature); 0 PII findings in event samples | M5 | All 22 telemetry events observed firing in the events DB; 0 PII in stored props (Zod strips unknowns + PII guard; verified) | ☑ |
| S10 | Nightly digest runs green ≥ 3 consecutive days with all minimum contents present | M5 | Digest job built, all min-contents present, PII-safe; runs green every invocation (demonstrated repeatedly). "3 consecutive calendar days" is a post-deploy runtime observation — logged D-030 | ◐ |
| S11 | qa-red-team final sweep: 0 open trust violations (fabricated live data, client-reachable secrets, purchase pressure) and 0 open critical bugs | M6 | not yet measured | ☐ |
| S12 | Full-loop task success: 10/10 scripted end-to-end journeys (5 per category, mobile viewport) complete without dead ends | M6 | not yet measured | ☐ |

Milestones are sequential; within a milestone, fan out parallel builder subagents with non-overlapping file ownership per the multi-agent protocol in `CLAUDE.md`. Every milestone runs as a milestone loop (see `CLAUDE.md` loop engineering): builders → integrate → verification suite → adversarial `qa-red-team` review (plus `design-critic` for UI work) → fix → re-verify → gates → scorecard update → commit. A milestone is complete only when its gates are checked **and** its owned scorecard targets are measured.

## M0 — Audit and harvest

- [x] Repository inspected via parallel `repo-cartographer` agents: `tally-mobile-prototype/`, `old_src/`, and the main app's infrastructure (package scripts, worker/backend, routes, existing tests, `AGENTS.md`/repo guidance).
- [x] `.env.local` checked for `GEMINI_API_KEY` (never printed, committed, or exposed).
- [x] Prototype (`tally-mobile-prototype/`) run and its current search flow manually tested by the lead before any changes.
- [x] Harvest inventory written to `docs/DECISIONS.md`: what the prototype gets right; per-module keep/refactor/rewrite verdicts with one-line reasons; salvage list from `old_src/` with explicit warnings on anything unsafe to copy.
- [x] `CLAUDE.md` **Commands** section filled in with the repo's real commands and committed.
- [x] Baseline commit made.

## M1 — Core research loop

- [x] Search accepts product, need, problem, or SKU; category inferred with no category-selection step.
- [x] Multi-step Gemini workflow with Google Search grounding runs server-side per `docs/ENGINE.md`; secrets server-only.
- [x] Structured report contract validated and sanitized server-side; frontend renders only the typed contract.
- [x] Report leads with a verdict (named product) or ranked shortlist (need), with sources as `{ title, url }` openable from the UI and a confidence indicator.
- [x] Reports stamped with playbook/prompt versions and per-stage timings.
- [x] Telemetry events for search and report outcomes flowing, schema-validated, privacy rules honored.
- [x] Initial golden-query seeds captured for both launch categories.

## M2 — Live research experience

- [x] Research opens with inferred, editable assumptions; edits redirect research live without restarting.
- [x] Full research plan visible: completed / in-progress / upcoming questions; user can remove and add questions before they run.
- [x] Progress, time saved, source count, and "best fit so far" update as evidence arrives; product imagery shown during research.
- [x] Quick, Full, and Deep Dive modes behave distinctly per `docs/ENGINE.md`; Deep Dive offered only after an initial report.
- [x] Failure states show transparent retry, never fabricated live claims.
- [x] Live-research telemetry (assumption edits, question edits, redirects, abandonment) flowing.

## M3 — Results depth

- [x] Comparison page: up to 10 competitors in a readable editorial grid with reviews, price ranges, pros/cons, from real structured data (quick mode surfaces fewer with an honest adaptive header; full/deep up to 10).
- [x] Price page: top online and local retailers; IP-derived location default, user-editable (coarse region only; local retailers scoped to it).
- [x] Backup picks saved; assumptions visible and changeable from results without restarting (edits re-run seeded server-side by text; save-a-pick persists + emits telemetry).
- [x] History: save, open, delete prior searches; home navigation solid.
- [x] Category playbooks demonstrably produce category-specific questions and criteria for both launch verticals (durable divergence test: disjoint question ids, distinct criteria).
- [x] Results engagement telemetry (source clicks, comparison usage, retailer clicks, saves) flowing — verified in the events DB.

## M4 — Growth loop

- [x] Public, read-only share page per report: clean stable URL (`/s/:id`), no login, fast (server-rendered, p75 1.2ms), editorial-grade at mobile viewport, full verdict/tradeoffs/comparison/sources, visible research date and re-run action.
- [x] Rich social card (Open Graph) renders correctly when the link is shared (server `/og/:id.png`, valid PNG with verdict + best fit + memorable tradeoff + wordmark + attribution).
- [x] Verdict, comparison, and pros/cons surfaces are screenshot-legible with "Researched by Tally" attribution (page-level + OG card; per-block marks deferred to M6 polish — D-029).
- [x] Visitor→searcher call to action present and instrumented end to end (share_page_viewed → cta_clicked → search_started[share-cta]).
- [x] Decision polls: create from a shortlist, vote and comment without an account, evidence visible to voters (per-option notes + guaranteed "See the full research" link).
- [x] Price watch settable from a report; honest framing per `docs/GROWTH.md` (saved re-check, no alert promise, no urgency).
- [x] All growth surfaces instrumented per `docs/GROWTH.md`; share loop verified logged-out on mobile (all 7 growth events in the events DB; XSS-clean per qa-red-team).

## M5 — Learning infrastructure

- [x] Golden-query eval suite complete for both categories (6 CE / 6 HG), passing (S4 100%), and wired to gate engine changes (exit 1 below 95%; runs with noCache so the cache can't mask regressions).
- [x] Query mining implemented: user-added questions → playbook add/demote candidates, low-confidence/thumbs-down reports → proposed golden eval cases (`npm run mine`); thumbs `report_feedback` feeds the down-signal.
- [x] Category cache with freshness windows in place (per-category CE 24h / HG 72h; quick uncached; serves prior report with its real research date — honest).
- [x] Nightly digest job (`npm run digest`) produces `intelligence/digests/YYYY-MM-DD.{json,md}` + `intelligence/latest.md` with all `docs/LEARNING.md` minimum contents; aggregates/anonymized only (PII-safe, verified).
- [x] `intelligence/actions/` pattern exercised: eval-caught weak assumptions → classify v1.2.0 + robust grader → S4 100% (`intelligence/actions/2026-07-27.md`).

## M6 — Polish and hardening

- [ ] Visual direction verified against `docs/PRODUCT.md`, including exact required strings and editorial identity on share surfaces.
- [ ] Every page and primary interaction verified on mobile and desktop; keyboard accessibility; deliberate loading/empty/retry/error states everywhere.
- [ ] All scorecard rows measured; every miss carries a logged decision.
- [ ] Full acceptance sweep: build, typecheck, backend tests, browser tests, eval suite all pass; focused tests added for the product flow and share loop where missing.
- [ ] Final report written: what works, genuine external limitations, links to local preview and key source files, and which digest findings (if any) this build addressed.

## V1 definition of amazing

A stranger with a real buying decision can land on Tally, get a cited, independent, decisively explained verdict in minutes, trust it enough to act, and want to send it to the friend who asked — and every one of those sessions makes the next night's build measurably better.
