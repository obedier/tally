# Tally — learning system

Every research query must make Tally smarter. Learning is infrastructure, not an afterthought. Two loops run continuously: a **runtime loop** that improves the research engine, and a **development loop** that feeds intelligence into nightly Claude Code builds.

## Telemetry — the raw material

Log a structured, typed, privacy-safe event stream for every session:

- Query text, inferred category, chosen mode, inferred vs. user-edited assumptions.
- Questions auto-generated, removed, and added by the user (user edits are direct signal that the playbook missed something).
- Mid-research redirects and feedback.
- Report outcomes: confidence level, source count and diversity, disagreement detected, retries, latency per stage, failures with reasons, and the playbook/prompt versions that produced the report.
- Engagement: source clicks, comparison usage, retailer clicks, saves, shares, poll creation, share-page visitor conversion, thumbs up/down, price-watch sets, post-purchase check-in responses.

Privacy rules are non-negotiable (see `CLAUDE.md`): anonymous session/device IDs only; never names, emails, precise location, or identifying query content; aggregate wherever raw text isn't needed; validate events server-side against a typed schema; never log secrets.

## Runtime loop — the engine improves from queries

Be precise about mechanism: this is systematic prompt, playbook, retrieval, and cache improvement — not model fine-tuning. Revisit fine-tuning only if a dedicated pipeline is ever justified; do not build toward it speculatively.

- **Versioned playbooks and prompts.** Every category playbook, question template, and synthesis prompt carries a version. Every report records the versions that produced it, so quality is attributable and regressions traceable.
- **Eval harness with golden queries.** Maintain a per-category suite of golden queries with graded expected properties: correct category inference, sensible assumptions, source diversity, verdict clarity, honest uncertainty. Run it on every meaningful engine change; nothing ships that regresses it.
- **Mining real queries.** Frequently user-added questions graduate into the playbook; frequently removed ones get demoted. Low-confidence and thumbs-down reports become new eval cases. Highly shared reports are studied for what made them excellent, and those patterns feed the synthesis prompts.
- **Category cache.** Slow-moving category knowledge (specs that matter, reliability patterns, deal seasonality) is cached with explicit freshness windows and refreshed by real traffic.

## Development loop — nightly intelligence for Claude Code

Every build starts from evidence about how yesterday's product actually performed.

- A scheduled server job aggregates the previous day's telemetry into two artifacts available to the repo: `intelligence/digests/YYYY-MM-DD.json` (machine-readable) and `intelligence/digests/YYYY-MM-DD.md` (human-readable), plus a rolling `intelligence/latest.md` copy.
- Digest minimum contents: top queries and categories; failure and retry rates by stage; lowest-confidence report patterns; most user-edited assumptions and questions (playbook gaps); flow abandonment points; share/poll/price-watch usage and share-page conversion; eval-suite status; **current values and day-over-day deltas for every V1 scorecard metric** in `docs/MILESTONES.md`; and a ranked **"top 5 suspected product problems"** section with supporting evidence.
- **Claude Code reads `intelligence/latest.md` at every session start** (this is codified in `CLAUDE.md`), treats its ranked problems as the default work queue, and records what was changed in response in `intelligence/actions/YYYY-MM-DD.md`. Every nightly build should ship at least one improvement traceable to real usage.
- Digests contain only aggregates and anonymized exemplars — safe to commit, never raw user-identifying data.

## Sequencing note

Telemetry emission ships with each feature from the first milestone — a feature without its events is unfinished. The aggregation layer (eval harness maturity, digest job) is completed as its own milestone; see `docs/MILESTONES.md`.
