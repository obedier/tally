# Tally — deferred work

Work that is real, scoped, and **not** currently being built. Created 2026-07-28
(D-044) because deferred items had been living as prose inside `docs/DECISIONS.md`,
where they are not greppable and were demonstrably forgotten: the product-image
subsystem was rewritten three times, each pass rediscovering the previous pass's
gap.

**Rules.** An item leaves this file only when it ships (with a `docs/DECISIONS.md`
entry) or is explicitly killed (with a one-line reason, kept below under *Killed*).
`docs/MILESTONES.md` remains the acceptance authority for V1 gates; this file is
the backlog behind it. Priorities: **P1** blocks quality or trust · **P2** real
improvement, not blocking · **P3** worth doing eventually.

---

## P1

### 1. Verify barcode scanning on a physical iPhone
**What:** Exercise the camera scanner end to end on real hardware — permission
prompt, a real UPC label, the research it starts.
**Why:** It has never been run against an actual camera. The iOS Simulator has no
camera, so simulator testing only ever reaches the "No camera available" state.
**Pros:** Closes the one unverified path in a shipped feature.
**Cons:** Needs a physical device and a barcode to point at.
**Context:** `src/client/components/home/ScanSheet.tsx`; `NSCameraUsageDescription`
is confirmed in the built app's Info.plist and Capacitor's bridge implements the
WKWebView media-capture permission delegate, so the pieces are in place. Also
unverified on device: the native share sheet and deep-link navigation (D-038).
**Effort:** S · **Blocked by:** physical device access

### 2. Fund or disconnect the Kimi second opinion
**What:** Either restore balance on the Moonshot account or set `KIMI_API_KEY`
empty in production.
**Why:** The account is suspended for insufficient balance, so
`auditReviewSummary` returns null on every report. That is handled correctly —
null renders as "not checked", never as "checked and fine" — but a permanently
dark cross-check is worse than an honest absence, because the operator stops
noticing it.
**Pros:** Either outcome makes the system's state truthful.
**Cons:** Costs money, or costs the feature.
**Context:** `src/server/kimi.ts`, `src/server/engine/reviewAudit.ts`, D-045. The
key in `~/.keys.sh` also needs rotating — it was exposed in a session transcript —
and its line is malformed (`export KIMI_SHELLY_API_KEY"sk-…"`, missing the `=`),
so the variable never actually exports.
**Effort:** S · **Blocked by:** owner billing decision

---

## P2

### 3. Decide the product-image direction on measured numbers
**What:** Read `productImages.displayRate` from the nightly digest after real
traffic accumulates, then choose: accept the rate, or add a structured product
image source (a retailer API or an open GTIN database — the barcode scanner made
GTINs first-class).
**Why:** This is review option 1B, deliberately gated on 1A's instrumentation.
Coverage was 24% best-fit / 6% alternatives when measured, and the *display* rate
is strictly lower and was never measured at all.
**Pros:** The first image decision in this repo made on evidence.
**Cons:** A product-image API adds an external dependency and licensing questions
that `CLAUDE.md`'s independence rules must answer first.
**Context:** `src/server/engine/images.ts`, D-044. **Do not open a fourth
heuristic pass on the harvester before reading the number.**
**Effort:** L · **Blocked by:** ~1 week of digest data

### 4. Restart the nightly learning loop
**What:** Get `npm run digest` running on a schedule again and resume the
`intelligence/actions/` cadence.
**Why:** `CLAUDE.md` calls this loop "the product's compounding advantage" and
specifies it never exits. It has completed exactly one cycle
(`intelligence/actions/2026-07-27.md`).
**Pros:** Every new metric added this session (image display rate, second-opinion
disagreement rate) only pays off through this loop.
**Cons:** Needs a cron/systemd timer on the prod VM.
**Effort:** M

### 5. Fix `search_started` entry coverage
**What:** Work out why the digest shows 60 `report_completed` against 6
`search_started`, and instrument the missing entry points.
**Why:** Nine of ten reports are not attributable to a tracked entry. Every
funnel or conversion number is computed on a broken denominator.
**Pros:** Makes growth measurement mean something.
**Cons:** Some of the gap is legitimately eval and re-run traffic; the fix is
partly classification, not just instrumentation.
**Effort:** M

### 6. Close the seven deferred UX items from D-037
**What:** 17pt body-text floor · history-row destructive-action separation and
44pt tap targets · sparse-prices honest empty state · the "4 +" affordance
collision · orange accent doing double duty as interactive and semantic ·
"Top pros" vs "Strengths" vocabulary drift between report and share page ·
assumptions editor consuming ~25% of report height.
**Why:** Found by a full `/ux` audit, deferred by owner decision, logged but not
tracked anywhere actionable until now.
**Context:** D-037. The owner flagged history-row destructive separation (5.1/5.2)
as the one to revisit first.
**Effort:** M (each S) · **Priority note:** 5.1/5.2 is arguably P1 — a delete
control adjacent to an open control at under 44pt is a real misfire risk.

---

### 11. Cut Kimi's evidence latency so it can become the default engine
**What:** Reduce the grounded evidence call from ~394s. It is 89% of a 442s
Kimi-only research and the ONLY thing keeping Gemini as the default.
**Why:** Kimi-only research now works correctly end to end (D-050) and cites
**direct publisher URLs** where Gemini returns `vertexaisearch` redirect
wrappers — the root cause of the 24% image-harvest rate and weak source links —
at ~2.7x lower cost per search. Only speed is missing.
**The measured bottleneck:** one grounded call generating ~10,827 output tokens
at Moonshot's ~30 tok/s. This is an OUTPUT LENGTH problem, not a model-choice
one — classify (7.6s) and synthesis (41.1s) are both fine.
**Levers, cheapest first:**
1. Shorten what the evidence prompt asks for in quick mode — the `concise` rule
   exists but the model still wrote ~5.5k characters. Fewer candidates and
   harder per-field caps should scale latency down almost linearly.
2. Split evidence across 2 smaller parallel grounded calls instead of 1 large
   sequential one; the pipeline already batches, it just runs them in series.
3. Re-check Moonshot for a faster model. `kimi-k3` exists but FAILS the grounded
   path (`tokenization failed` on the tool-echo hop); `kimi-k2.7-code-highspeed`
   is untested for research.
**Careful:** every iteration costs ~7 minutes of wall clock. Change one lever at
a time and measure with `KIMI_DEBUG=1`, which logs per-hop timing.
**Context:** `src/server/kimi.ts`, `researchProvider.ts`, D-050. Config today is
`RESEARCH_PROVIDER=kimi` + optional `RESEARCH_FALLBACK=false`.
**Effort:** M · **Priority:** P2 — raises to P1 if image quality or unit cost
becomes pressing, since Kimi fixes both

## P3

### 7. Resolve hostnames before fetching (SSRF hardening)
**What:** Resolve each candidate host and re-check the resulting IP before
connecting, closing DNS rebinding.
**Why:** `isPubliclyFetchable` blocks private *hostnames and IP literals*, and
redirects are followed manually with every hop re-validated — but a public name
that resolves to a private address still passes.
**Pros:** Closes the last SSRF gap in a path fed by model output.
**Cons:** Meaningful complexity for a bounded blast radius: the response is
parsed for og/JSON-LD and never returned to a client.
**Context:** `src/server/engine/images.ts`, documented in-file. **Effort:** M

### 8. Chaos test for the harvest budget race
**What:** A test where every page fetch hangs, asserting `harvestImages` still
resolves within its budget and the report completes.
**Why:** The `Promise.race` budget is the only thing preventing a hung fetch from
stalling a finished report, and nothing tests it.
**Effort:** S

### 9. Second-opinion coverage beyond the best fit
**What:** Audit alternatives' review summaries too, not just the best fit.
**Why:** Currently bounded to one pick to bound latency and cost, matching the
image decision.
**Cons:** Multiplies second-provider calls per report; only worth it once the
provider is funded and the best-fit audit has proven its disagreement rate is
informative rather than noisy.
**Effort:** M · **Blocked by:** item 2

### 10. Prod deploy runbook
**What:** Write down the deploy procedure and its failure modes.
**Why:** `npm ci --omit=dev` on the prod VM strips the build toolchain; the build
then fails, and because the piped command's exit status is `tail`'s, the chain
continues to `systemctl restart` and the service comes up against a failed build.
This caused a ~1 minute outage on 2026-07-28.
**Correct command:** `npm install` (never `npm ci --omit=dev`), and check the
build's real exit status before restarting.
**Effort:** S

---

## Killed

_(nothing yet)_
