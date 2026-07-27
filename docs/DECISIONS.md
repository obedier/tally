# Tally — decisions log (append-only)

Format: `D-NNN (date) — decision — reason`. Newest at the bottom. Harvest inventory from M0 first.

---

## M0 harvest inventory (2026-07-27)

Sources: three parallel repo-cartographer audits (prototype app, old_src, infrastructure) plus the lead's manual test of the running prototype (real Gemini search for "Dyson V12 Detect": 200 in ~16s, 15 grounded sources, source redirect verified resolving to dyson.com/…/reviews).

### What the prototype gets right (harvest and keep)

- **Visual identity** — Playfair Display + DM Sans, paper `#fbfaf7`, forest green `#12543b`, rust orange `#d94d18`, object-only product imagery. Home hierarchy matches `docs/PRODUCT.md` almost exactly. This is the design foundation for V1.
- **Required copy strings** — "Know before you buy.", "Product, Need, Problem, SKU…", "Deep product research.", "Try Dyson V12 Detect" all exact. One deviation: "Try **B**est vacuum for pet hair" (must be lowercase "best").
- **Flow skeleton** — home → live research → summary → product detail → prices, with sources/assumptions/questions bottom sheets, matches the results contract. The interaction model (editable assumptions sheet, add/remove questions, "best fit so far" rail) is the right shape.
- **Working Gemini seam** — `POST /api/research` with Google Search grounding works end-to-end; grounding-chunk → `{title,url}` source extraction is correct; anti-fabrication prompt clause ("Never invent exact review counts… use ranges") is worth carrying forward.
- **Secret handling is clean** — `GEMINI_API_KEY` server-side only in both dev middleware and worker; zero `VITE_`/`import.meta.env` usage; verified absent from built bundle.
- **Copy voice** — "Here's what we're checking.", "Rankings evolve as we learn more.", "Completed work stays intact. We'll only revisit comparisons affected by your changes." — keep this voice.
- **Worker SPA/asset fallback logic + `tests/sites-worker.test.mjs`** — small but correct, with good negative cases.

### Per-module verdicts

| Module | Verdict | Reason |
|---|---|---|
| Visual design (CSS tokens, type, home layout) | **KEEP (re-implement cleanly)** | Direction is right; but 6 hand-minified CSS layers with a forked green/orange palette in `pixel-home.css` must be consolidated into one token set. |
| `src/mobile/` device simulator + `styles.css` | **RETIRE for product** | It renders a fake iPhone bezel around the app — prototyping scaffolding, not a shippable mobile web app. Keep the prototype dir runnable as reference. |
| `Prototype.tsx` (all 5 screens in one 22KB file) | **REWRITE** | No routing, no URL state, no persistence, positional-boolean assumptions, untyped LLM cast, 15 useState hooks in one component. Flows/copy harvested; code not. |
| Live-research screen | **REWRITE** | Static mockup: hardcoded vacuum questions, fake 42% progress, fake "12 sources scanned" — confirmed live during manual test (still said "Researching now" after completion). |
| Domain model (`Report` etc.) | **REWRITE** | All-string presentation DTO; no ids, versions, timings, provenance, numeric prices. Cannot support ranking, price watch, sharing, or telemetry. |
| `worker/index.js` Gemini handler | **REWRITE (seed from it)** | Correct key handling and grounding extraction, but: no validation, no streaming, key in query string, `*` CORS on a billable endpoint, raw upstream errors echoed, prompt duplicated+drifted vs. vite dev middleware, 0 of 7 ENGINE.md stages. |
| Vite dev API middleware | **RETIRE** | Second drifted copy of the worker; V1 uses one shared server module. |
| `index.html` | **REWRITE** | Still "Mobile Prototype Boilerplate"; no OG/meta/favicon — fatal for share pages. |
| `tests/sites-worker.test.mjs` | **KEEP** | Sound; extend with `/api/research` cases. |
| Playwright runtime tests | **KEEP with prototype** | They guard the simulator, not the product; stay with the reference prototype (1 known red test: keyboard/footer dismissal). |
| AGENTS.md / design-qa.md / runtime lock | **KEEP as prototype-local** | Their protections apply inside `tally-mobile-prototype/` only; V1 is built outside it, so no conflict. |

### old_src salvage list

**Empty.** `old_src/` verified **byte-identical** to `tally-mobile-prototype/` (`diff -rq` + md5 spot-checks; only gitignored artifacts differ). There is no earlier iteration to mine.

### Trust violations found in the prototype (must not survive into V1)

1. **Fabricated-data backfill (blocking)** — `makeFallbackReport()` hardcodes a fictional Dyson report (invented prices, "14,231 verified reviews", 10 fake competitor entries, 5 fake retailer rows) and silently merges it under any live report whose fields are missing, and fully replaces the report on any error, labeled only by a 10px caption. Violates non-negotiable #3.
2. Fake progress (42% constant), fake "12 sources scanned" counter, fake pre-seeded "Recent research" history, unsourced "hours saved" headline metric.
3. Open Gemini proxy: `*` CORS, no auth/rate limit; dev server binds `0.0.0.0` with the key-bearing middleware; key sent in URL query string; raw upstream error bodies echoed to clients.

---

## Decisions

- **D-001 (2026-07-27)** — `old_src/` deleted after baseline commit preserved it in git history. Verified byte-identical to the prototype; keeping it would send every future session on a false salvage hunt. CLAUDE.md prototype policy amended accordingly.
- **D-002 (2026-07-27)** — Created `.claude/agents/` definitions (repo-cartographer, qa-red-team, design-critic) — CLAUDE.md referenced them but they did not exist in the repo.
- **D-003 (2026-07-27)** — V1 is built as a fresh app at repo root (`app/` + `server/` boundaries decided at M1 planning), NOT by mutating `tally-mobile-prototype/`. Reasons: the prototype is hash-locked (28 protected files gate dev/build), its backend is declared protected by its AGENTS.md, and its device-simulator shell is demo scaffolding. The prototype stays runnable as the visual/flow reference.
- **D-004 (2026-07-27)** — The device-bezel simulator (`src/mobile/`) is retired for the product: V1 ships as a true mobile-first responsive web app. The simulator's gesture/keyboard lessons inform the real app but the fake phone frame does not ship.
- **D-005 (2026-07-27)** — The fabricated-fallback pattern (D1 above) is treated as a blocking defect: V1's failure state is a transparent retry, and any demo data is explicitly labeled. Golden rule enforced by eval + QA before every milestone gate.
- **D-006 (2026-07-27)** — Commands section of CLAUDE.md filled with prototype-reference commands now; will be updated to the V1 app's commands when M1 scaffolding lands.
- **D-007 (2026-07-27)** — The live `GEMINI_API_KEY` in `tally-mobile-prototype/.env.local` predates git init and was never committed (verified). Rotation recommended to the owner but not blocking local development.
- **D-008 (2026-07-27)** — V1 stack: single root package. Vite + React 19 + react-router (client, port 5200), Hono on Node via tsx (server, port 8787, `/api` proxied in dev), Zod contracts in `src/shared/` shared across the seam, better-sqlite3 at `data/tally.db` for server-side persistence (reports, telemetry, later shares/polls). Stable-version pins (TS 5.x, Vite 6) — not the prototype's bleeding-edge TS 7/Vite 8. Fonts self-hosted via @fontsource.
- **D-009 (2026-07-27)** — Research transport: SSE (`GET /api/research/stream`) streaming typed `ResearchEvent`s (stage/assumptions/plan/sources/best-fit-so-far/report/error) so M2's live experience builds on the same bus; plus non-streaming `POST /api/research` for the eval harness. Gemini key travels in the `x-goog-api-key` header (never URL), errors map to stable codes (never raw upstream bodies), server binds 127.0.0.1.
- **D-010 (2026-07-27)** — Engine latency budget: classify (1 ungrounded JSON call) → plan (no call, playbook-driven) → evidence (1 grounded call quick / ≤3 full) → synthesize (1 ungrounded call) → server-side sanitize. Per-question grounded calls rejected for V1: 7×~16s breaks the S1 time-to-verdict target.
- **D-011 (2026-07-27)** — S5 enforced in code, not prompts: the sanitizer caps confidence at "medium" and appends an explicit gap sentence to `confidenceReason` whenever a report has < 8 sources or < 3 source classes.
- **D-012 (2026-07-27)** — M1 builder decisions ratified: example chips start research immediately (else `entry:example-chip` telemetry could never fire honestly); history "Search again" re-runs with mode full; inline two-step delete instead of `window.confirm`; assumptions read-only during research in M1 with an explicit "editing comes next" note (no fake interactions); deep mode = 3 evidence calls in M1 (true iterative deep-dive is M2 work); partial evidence tolerated (≥1 of 3 groups) with S5 confidence capping; `saveReport` failure non-fatal but loudly logged; missing `mode` → 400, no silent default.
- **D-013 (2026-07-27)** — Telemetry PII guard scans string prop values (not format-constrained envelope fields); phone pattern tuned to avoid false positives on product names ("iPhone 15 Pro Max 256GB" passes). Rejections stored as counters only, never raw payloads.
- **D-014 (2026-07-27)** — Contract additions during integration: `ReportListItemSchema`, error code `not-found`, and `retailer_clicked` telemetry event (decision-confidence signal #1 per docs/PRODUCT.md) wired into the prices page.
- **D-015 (2026-07-27)** — Known quality debt carried into the M1 review loop: quick-mode latency ~68s vs ~30s spec target (grounded evidence call + synthesis dominate — S1 is M2-owned; candidate fixes: leaner evidence output shape, faster synthesis model); engine-added plan questions sometimes phrased as questions to the user; "Top cons" placeholder when no cons evidenced; prices rows can read "Check retailer" twice.
- **D-016 (2026-07-27)** — M1 adversarial-review fix wave (design-critic + qa-red-team findings, all confirmed): (a) synthesize stage timeout raised 25s→90s — root cause of all four full-mode eval 502s (observed generation ~23s+ vs 25s cap); (b) competitor-brand sellers filtered from the best-fit retailer list in the sanitizer + prompt rule (trust finding T1) with regression test; (c) tampered/unknown `mode` now falls back to quick (cheapest), never full; (d) inbound rate limiting added to both research endpoints — sliding window 12 starts/10min per IP+session (sized to keep the sequential eval suite under the cap); (e) telemetry duplicate eventIds now counted truthfully as rejected ("duplicate-event-id"), not accepted; (f) prompts 1.1.0: classify extras must be researchable (never questions to the user) + SKU→"other" guidance; synthesize headline ≤18 words, ≥1 genuine con, retailers best-fit-only, post-evidence `categoryCheck`; (g) sanitizer applies categoryCheck only when classify confidence < 0.6 (fixes SKU category, regression-tested); (h) client polish: compare empty slots instead of bare dashes, designed no-price header, per-row fallback dedupe, sources-sheet domain dedupe.
- **D-017 (2026-07-27)** — Reports are immutable snapshots: sanitizer/prompt improvements do not rewrite stored reports. Dev-era reports with pre-fix artifacts get purged before ship (M6 sweep).
- **D-018 (2026-07-27)** — qa-red-team confirmed clean: no key material in bundle or errors, XSS fully escaped end-to-end, PII guard rejecting, path traversal safe, honest failure envelopes. S3 measured 0.0% contract-failure across the 12-case golden suite (target < 1%).
