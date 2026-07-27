# Tally V1 — build report

_V1 complete — all six milestones (M0–M6) done; 9 scorecard targets met, 3 accepted partials logged._

Tally is an independent, mobile-first AI product-research app. A user enters a product, need,
problem, or SKU; Tally runs visible, evidence-backed research with Gemini + Google Search grounding
and returns a cited, independently ranked verdict good enough to send to a friend.

## What works (end to end, verified in the running app)

**The core research loop (M1).** Search accepts product / need / problem / SKU with no
category-selection step; a multi-step server-side Gemini workflow (classify → plan → grounded
evidence batches → synthesize → sanitize/assemble) produces a Zod-validated report contract. The
frontend only ever renders the stable contract. Reports lead with a named verdict (or ranked
shortlist), confidence + honest confidence reason, decisive factors, best fit with pros/cons,
sources openable from the UI. Secrets are server-only; the client bundle never contains the key.

**Live research experience (M2).** Research runs as a server-side steerable session with an
append-only SSE event log that replays losslessly on reload. Assumptions and the question plan are
editable mid-run; edits redirect research without restarting. Best-fit-so-far, source count, and an
honest time-saved estimate stream as evidence arrives. Quick / Full / Deep modes behave distinctly;
Deep Dive is offered only after an initial report. Failure states are transparent retries — never
fabricated live claims.

**Results depth (M3).** Comparison grid of up to 10 competitors with grounded pros/cons and review
summaries; price page grouping online vs local retailers with a coarse, editable, IP-derived
location scoping local listings; change-assumptions-from-results via a seeded re-run; save-a-pick;
history save/open/delete; category playbooks produce demonstrably category-specific questions.

**Growth loop (M4).** Server-rendered public share pages (`/s/:id`) with per-report OpenGraph/Twitter
meta and a branded OG PNG (`/og/:id.png`); decision polls (account-free vote + comment, one vote per
device, evidence visible to voters); price watch with honest saved-re-check framing; a
visitor→searcher CTA instrumented end to end; "Researched by Tally" attribution. Server-rendered
share HTML is XSS-proven-clean.

**Learning infrastructure (M5).** A golden-query eval suite (12 cases, both categories) that gates
engine changes (fails the build below 95%, runs with `noCache` so the cache can't mask a
regression). Query mining turns user-added questions and low-confidence/thumbs-down reports into
playbook candidates and proposed eval cases. A category cache with per-category freshness windows
(honest — serves the prior report with its real research date). A nightly digest job producing all
`docs/LEARNING.md` minimum contents plus a ranked Top-5 suspected-problems section, aggregates and
anonymized exemplars only. The actions loop was exercised for real (see below).

## The learning loop already compounded once

M5's eval harness caught genuinely weak, tautological assumptions on named-product queries
("You are looking for a MacBook Air M4 13-inch" — a restatement, not a decision input). That drove a
real engine improvement — classify prompt v1.1.0 → v1.2.0, requiring decision-relevant assumptions
and forbidding query restatement/filler — and a robustness fix to the grader itself. Logged in
`intelligence/actions/2026-07-27.md`. This is the product's compounding advantage working on day one.

## Non-negotiables held

- **Independence** — rankings are never influenced by money; no growth mechanic adds purchase
  pressure, fake urgency, or fake scarcity. (Confirmed by both adversarial reviewers across M3/M4.)
- **Secrets server-only** — the Gemini key exists only as a server env var; never in the client
  bundle, share HTML, or logs.
- **No fabricated live data** — grounded evidence or honest empty/retry states; demo data labeled;
  cached reports carry their real research date and are never relabeled "now".
- **Telemetry privacy** — anonymous session/device ids; 0 PII in stored event props (Zod strips
  unknown fields + a PII guard); committed digests contain 0 emails/markup.
- **Honest uncertainty** — "No verified rating", confidence reasons, transparent failures.

## V1 scorecard (see docs/MILESTONES.md for the authoritative table)

**Met (9):** S2 (first activity ≤3s), S3 (0.0% contract failures), S4 (100% eval pass), S5 (source
diversity), S6 (share p75 1.2ms + OG renders), S7 (visitor→searcher funnel), S9 (100% telemetry
coverage, 0 PII), S11 (final qa sweep — 0 trust violations, 0 critical bugs), S12 (10/10 e2e journeys).

**Accepted partials (3), each logged:** S1 (full p75 ~160s ✓; quick p75 ~49s, ~4s over the 45s
target after M3/M5 enrichment — D-031), S8 (measured by proxy — bundle within budget, a11y met, no
console errors; full Lighthouse at deploy — D-031), S10 (digest job complete + reliable; the
"3 consecutive green days" is a post-deploy runtime observation — D-030).

## Genuine external limitations (honest)

- **No production deploy in this build.** The app runs locally (Vite client + Hono server + SQLite).
  Production SPA static-serving (`serveStatic`) and a real domain are deferred to deployment; share
  pages work in dev via the Vite proxy. OG cards use real geo headers (Cloudflare/Vercel) in
  production; locally they fall back to a labeled "United States" default.
- **No email/push infrastructure**, so price watch is honestly a saved re-check the user returns to,
  not a delivered alert. Framed as such — no false promise.
- **Per-retailer prices are often a single evidence-derived range** ("check the listing"), not
  live-fetched per-seller prices — honest, but a real depth limit until a price feed exists.
- **S10's "3 consecutive green days"** is a post-deploy runtime observation; the digest job itself is
  complete, reliable, and PII-safe.
- **No licensed per-product imagery**; research uses ambient category object art, never fake product
  photos.

## Local preview + key source files

- Run: `npm run dev` (client :5200, server :8787). Jobs: `npm run digest`, `npm run mine`, `npm run evals`.
- Report contract: `src/shared/report.ts`; telemetry: `src/shared/telemetry.ts`.
- Engine: `src/server/engine/{pipeline,sanitize,prompts,cache}.ts`; sessions `src/server/engine/session.ts`.
- Growth: `src/server/routes/{share,polls,priceWatch}.ts`, `src/server/og/card.ts`, `src/server/share/html.ts`.
- Learning: `evals/run.ts`, `src/server/jobs/{digest,mining}.ts`; `intelligence/`.
- Decisions log: `docs/DECISIONS.md` (D-001..D-030); state: `docs/MILESTONES.md`.

## Digest findings addressed this build

- **Weak named-product assumptions** (top eval failure) → classify v1.2.0 + robust grader → S4 100%.
- Noted for future: `synthesize` is the highest historical failure stage (pre-dating the M1 timeout
  fix); abandonment clusters at evidence batches 1 and 3 (test-traffic artifact — watch on real usage).
