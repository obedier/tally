# Tally — research engine architecture (Gemini)

Gemini is a server-side research engine. Key handling rules are in `CLAUDE.md` non-negotiables and are absolute.

## Research workflow

Run a deliberate multi-step workflow, not a single prompt:

1. **Classify** the request: named product vs. need vs. problem vs. SKU; infer category and confidence.
2. **Infer assumptions** from the prompt (budget, use case, constraints, location); surface them as editable, and honor user edits mid-run.
3. **Select the category playbook** (versioned; see `docs/LEARNING.md`) and generate the question plan from it.
4. **Gather grounded evidence** with Google Search grounding, question by question, honoring user additions/removals as they happen.
5. **Detect disagreement and staleness** across sources; trigger follow-up queries where sources conflict or data looks outdated.
6. **Compare candidates** on the criteria that matter for this user's assumptions.
7. **Synthesize** the recommendation: verdict, tradeoffs, confidence, backup picks.

Mode behavior: **Quick** trims the question plan to the highest-leverage questions (~30s); **Full** runs the complete playbook; **Deep dive** continues until the engine judges evidence sufficient, and is offered only after an initial report exists.

## Structured report contract

- Ask Gemini for structured output; validate server-side; sanitize missing/malformed values; return only a stable, typed product-report contract to the frontend. The frontend never parses raw model text.
- Capture and return grounding sources as `{ title, url }`.
- Classify evidence provenance wherever possible: manufacturer claims vs. retailer data vs. editorial testing vs. verified-owner review themes. Apply source-diversity and recency checks; a report leaning on one source class must say so in its confidence indicator.
- Stamp every report with: playbook version, prompt versions, per-stage timings, source count/diversity, retries, and detected disagreements — the learning system depends on these fields.

## Failure behavior

- If live research fails, show a transparent retry state — never fabricated live claims. A clearly labeled local/demo fallback is acceptable only during development.
- Budget latency per stage and surface honest progress; a stalled stage shows as stalled, not as fake progress.

## Performance and cost

- Stream partial results to power "best fit so far" rather than waiting for full synthesis.
- Cache slow-moving category knowledge (which specs matter, known reliability patterns, seasonal deal timing) with explicit freshness windows, refreshed by real traffic — never re-derive it per session (see `docs/LEARNING.md`).
- Mid-research user feedback redirects remaining work; never discard completed evidence or re-spend calls on questions the user removed.
