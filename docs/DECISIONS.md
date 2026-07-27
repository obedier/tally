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
