# Tally nightly digest — 2026-07-27

Window: 2026-07-27T00:00:00.000Z → 2026-07-28T00:00:00.000Z
Total telemetry events: **486**

_Aggregates and anonymized exemplars only — no raw user data (per docs/LEARNING.md)._

## Event volume

- `research_stage_completed` — 313
- `report_completed` — 60
- `report_viewed` — 58
- `comparison_used` — 10
- `research_abandoned` — 7
- `search_started` — 6
- `share_page_viewed` — 6
- `report_failed` — 4
- `source_clicked` — 3
- `research_redirected` — 3
- `assumption_edited` — 2
- `question_edited` — 2
- `price_watch_set` — 2
- `cta_clicked` — 2
- `deep_dive_started` — 1
- `pick_saved` — 1
- `poll_voted` — 1
- `share_created` — 1
- `poll_created` — 1
- `report_feedback` — 1
- `retailer_clicked` — 1
- `poll_commented` — 1

## Top categories

- **home-goods** — 33 reports (55%)
- **consumer-electronics** — 24 reports (40%)
- **other** — 3 reports (5%)

## Anonymized query exemplars

_By category · query type (never raw query text)._

- home-goods · need — 17
- consumer-electronics · named-product — 10
- home-goods · named-product — 9
- consumer-electronics · need — 8
- home-goods · problem — 7
- consumer-electronics · problem — 3
- consumer-electronics · sku — 3
- other · problem — 2
- other · sku — 1

## Failure & retry rates by stage

| Stage | Attempts | Failures | Failure rate | Retries | Retry rate |
|-------|---------:|---------:|-------------:|--------:|-----------:|
| synthesize | 64 | 4 | 6.3% | 5 | 7% |
| classify | 64 | 0 | 0.0% | 0 | 0% |
| plan | 64 | 0 | 0.0% | 0 | 0% |
| evidence-1 | 64 | 0 | 0.0% | 1 | 2% |
| evidence-2 | 31 | 0 | 0.0% | 1 | 3% |
| evidence-3 | 28 | 0 | 0.0% | 2 | 7% |
| evidence-4 | 1 | 0 | 0.0% | 0 | 0% |
| evidence-5 | 1 | 0 | 0.0% | 0 | 0% |

## Lowest-confidence report patterns

Confidence distribution — high: 41, medium: 18, low: 1.
Feedback — 👍 1 / 👎 0.

Low/medium confidence by category:
- home-goods — 9
- consumer-electronics — 8
- other — 2

## Most user-edited assumptions & questions

Assumption edits: 2 (dismissed: 2).
Question edits: 2 (added: 2).

## Flow abandonment points

- **evidence-1** — 3 abandonment(s), avg 22227ms elapsed
- **evidence-3** — 2 abandonment(s), avg 99906ms elapsed
- **synthesize** — 1 abandonment(s), avg 127199ms elapsed
- **evidence-2** — 1 abandonment(s), avg 32806ms elapsed

## Share / poll / price-watch usage

- Shares created: 1
- Share pages viewed: 6
- CTA clicks: 2
- Share-page conversion (cta/view): 33%
- Polls — created 1, voted 1, commented 1
- Price watches set: 2

## Eval-suite status

- File: `2026-07-27T20-01-15-369Z.json` (ran 2026-07-27T20:01:15.366Z)
- Cases: 12
- Pass rate: 91.7% (target 95%)
- Contract failure rate: 0.0%

## V1 scorecard — current values & day-over-day deltas

_No previous digest found; deltas start tomorrow._

Computed engine metrics (day-over-day):

| Metric | Value | Δ vs prev |
|--------|------:|----------:|
| reportsCompleted | 60 | — |
| reportFailureRate | 0.0625 | — |
| reportTotalMsP75 | 127904 | — |
| avgSourceCount | 42.88 | — |
| evalPassRate | [redacted-number] | — |
| evalContractFailureRate | 0 | — |
| sharePageConversion | 0.3333 | — |

Scorecard targets (from docs/MILESTONES.md):

| # | Target | Owned | Measured | Status |
|---|--------|-------|----------|--------|
| S1 | Quick mode time-to-verdict p75 ≤ 45s; Full ≤ 4 min (real Gemini, both categories) | M2 | Full p75 152s ≤240s ☑; Quick unsteered 33–44s (3 golden), steered runs +1 batch push p75 ~77s — see D-024 | ◐ |
| S2 | First visible research activity (assumptions or plan) ≤ 3s after search; "best fit so far" ≤ 30s | M2 | assumptions event 2.1s ✓; best-fit-so-far after batch 1 (~17–27s) ✓ | ☑ |
| S3 | Report contract validation failure rate < 1% across the golden-query suite | M1 | 0.0% across 16 golden-suite runs (2026-07-27, evals/results/) | ☑ |
| S4 | Golden-query eval pass rate ≥ 95%, evals wired to block regressing engine changes | M5 | not yet measured | ☐ |
| S5 | Every report: ≥ 8 sources, ≥ 3 source classes represented or confidence indicator says why not | M1 | 12/12 golden reports satisfy (sanitizer-enforced cap + gap sentence; eval sourceDiversity check) | ☑ |
| S6 | Share page p75 load ≤ 2.5s at mobile viewport; OG card renders correctly in a link-preview check | M4 | Share p75 1.2ms server response (self-contained ~25KB HTML, no external resources); OG `/og/:id.png` valid 1200×630 PNG. Full mobile Lighthouse LCP confirmed in M6 (S8). | ☑ |
| S7 | Visitor→searcher CTA conversion instrumented end-to-end; baseline recorded from real test sessions | M4 | Funnel wired + observed firing: share_page_viewed → cta_clicked → search_started(entry="share-cta"); events recorded in DB | ☑ |
| S8 | Lighthouse mobile ≥ 90 (performance and accessibility) on home, report, and share pages | M6 | not yet measured | ☐ |
| S9 | 100% of shipped features emit their telemetry events (audited feature-by-feature); 0 PII findings in event samples | M5 | not yet measured | ☐ |
| S10 | Nightly digest runs green ≥ 3 consecutive days with all minimum contents present | M5 | not yet measured | ☐ |
| S11 | qa-red-team final sweep: 0 open trust violations (fabricated live data, client-reachable secrets, purchase pressure) and 0 open critical bugs | M6 | not yet measured | ☐ |
| S12 | Full-loop task success: 10/10 scripted end-to-end journeys (5 per category, mobile viewport) complete without dead ends | M6 | not yet measured | ☐ |

## Top 5 suspected product problems

1. **Users abandon research at the "evidence-1" stage**
   - Signal: `research_abandoned`
   - Evidence: 3 abandonments at "evidence-1" (avg 22227ms elapsed before leaving).
2. **"synthesize" stage is failing**
   - Signal: `report_failed`
   - Evidence: 4 failure(s) at "synthesize" over 64 attempt(s) (failure rate 6.3%).
3. **Users abandon research at the "evidence-3" stage**
   - Signal: `research_abandoned`
   - Evidence: 2 abandonments at "evidence-3" (avg 99906ms elapsed before leaving).
4. **Users abandon research at the "synthesize" stage**
   - Signal: `research_abandoned`
   - Evidence: 1 abandonment at "synthesize" (avg 127199ms elapsed before leaving).
5. **Users abandon research at the "evidence-2" stage**
   - Signal: `research_abandoned`
   - Evidence: 1 abandonment at "evidence-2" (avg 32806ms elapsed before leaving).
