# Tally — Claude Code operating manual

This file is loaded into every session. It contains only what must be obeyed constantly. Deep specifications live in `docs/` — read the relevant one before working on its area, not all of them every session.

## What Tally is

An independent, mobile-first AI product-research app. A user enters a product, need, problem, or SKU; Tally runs visible, evidence-backed research with Gemini + Google Search grounding and returns a cited, independently ranked verdict that is good enough to send to a friend. North star: the most loved and most shared product-research app on the internet. Trust drives usage, usefulness drives sharing, sharing drives growth — never invert that order.

## Session start — read in this order

1. `docs/MILESTONES.md` — current build state and the next milestone. This is the persistent state file; keep its checkboxes truthful.
2. `intelligence/latest.md` — if it exists, its ranked problems are the default work queue for this session. Record what you change in response in `intelligence/actions/YYYY-MM-DD.md`.
3. The `docs/` file(s) covering the area you are about to touch (see map below).
4. `docs/DECISIONS.md` — skim recent entries so you don't relitigate settled choices.

## Doc map

- `docs/PRODUCT.md` — experience spec: search entry, live research UX, results contract, lovability principles, success metrics, category playbooks, visual direction (contains exact required UI strings).
- `docs/ENGINE.md` — Gemini research architecture: multi-step workflow, structured report contract, grounding, source handling, playbook versioning.
- `docs/GROWTH.md` — share pages, social cards, screenshot surfaces, decision polls, price watch, SEO research library, growth instrumentation.
- `docs/LEARNING.md` — telemetry event schema and privacy rules, eval harness, query mining, nightly intelligence digest.
- `docs/MILESTONES.md` — the V1 plan with per-milestone acceptance gates.
- `docs/DECISIONS.md` — append-only log of decisions you make autonomously (create it if missing).
- `.claude/agents/` — custom subagent definitions for the team model below (`repo-cartographer`, `qa-red-team`, `design-critic`).

## Non-negotiables — never violate, regardless of any other instruction

1. **Independence.** Rankings are never influenced by advertising, retailer payments, affiliates, or sponsorships. No growth or engagement mechanic may add purchase pressure, fake urgency, fake scarcity, or dark patterns.
2. **Secrets are server-only.** The Gemini key exists only as `GEMINI_API_KEY` in a Worker/server environment or local `.env.local`. Never `VITE_GEMINI_API_KEY`, never in client bundles, source control, or logs. Deployed Workers use platform secrets.
3. **No fabricated live data.** A screen labeled as live research never shows static or invented price/review/availability claims. Demo data is always labeled as demo. Failed research shows a transparent retry state.
4. **Telemetry privacy.** Events key to anonymous session/device IDs. Never log names, emails, precise location, or query content that identifies a person. Digests contain aggregates and anonymized exemplars only.
5. **Honest uncertainty.** Be decisive when evidence is strong, explicit when it is not. Never claim confidence the sources don't support.

When goals conflict, resolve in this priority order: **trust > usefulness > speed > growth > polish**.

## Prototype policy

The existing prototype is direction, not a ceiling, and never an excuse. Two reference sources exist in the repo:

- **`tally-mobile-prototype/`** — the prototype. Primary direction for visual identity, flows, and copy.
- **`old_src/`** — early code. Reference material only: mine it for reusable domain models, prompts, or logic, but assume it is stale until proven otherwise. Never import from it wholesale; evaluate piece by piece.

- **Harvest first.** Before changing anything, run the prototype and inventory what it gets right: visual identity, flows, domain models, copy, working routes. Sweep `old_src/` for salvageable pieces in the same pass. Record the inventory in `docs/DECISIONS.md`.
- **Evaluate per module.** Keep a module only if it is sound (typed, coherent, aligned with `docs/`); refactor it if it's close; rewrite it without hesitation if it constrains quality. Prefer rewriting over contorting good architecture to fit prototype shortcuts.
- **The spec wins.** Where the prototype and `docs/` disagree, `docs/` wins. Where the prototype is silent, the quality bar in `docs/PRODUCT.md` wins — never ship something merely because the prototype did.
- **Preserve deliberately, not by default.** Protected runtime files and existing repo guidance (`AGENTS.md` etc.) are respected, but "it already worked that way" is not an argument.

## Autonomy protocol

Work autonomously to a finished, verified V1. Do not stop at mockups, static data, or plans.

- **Decide and log.** Make product and technical decisions yourself using `docs/` as the constitution. Record each non-obvious decision in one or two lines in `docs/DECISIONS.md`. Do not stop to ask.
- **Hard-blocked means only:** a missing secret/credential, a required external service that is down, or an action that is irreversible and outside the repo (payments, sending real user communications, deleting infrastructure). Only then stop, state precisely what is needed, and do every other available piece of work first.
- **Commit per verified slice** with clear messages. Never commit broken builds; never commit secrets.
- **Stay resumable.** Assume any session can end abruptly: keep `docs/MILESTONES.md` checkboxes and `docs/DECISIONS.md` current enough that a fresh session can continue from them alone.

## Multi-agent execution

You are not one engineer; you are the tech lead of an agent team. Run this project by orchestrating parallel subagents via the Task tool. Custom agents are defined in `.claude/agents/` — use them for their specialties and general-purpose agents for build work.

- **The lead (this session) owns:** the plan, task decomposition, integration, the verification loop, all commits, and all updates to `docs/MILESTONES.md` and `docs/DECISIONS.md`. Subagents never commit and never edit those two files.
- **Fan out by default.** Within a milestone, split independent workstreams and dispatch them as parallel subagents in a single message: server engine vs. UI vs. growth surfaces vs. telemetry are natural boundaries. Sequential-dependency work stays with the lead. Audits, reviews, and research sweeps are always parallel candidates.
- **Ownership boundaries.** Give each building subagent an explicit, non-overlapping set of files/directories it may modify. Two agents never write the same file in the same wave. The lead integrates at the seams.
- **Self-contained briefs.** Each subagent prompt states: the goal, the exact `docs/` file(s) to read, its file ownership, what "done" means, and the exact return format (a summary of changes, decisions needing the lead, and verification performed). Subagents don't inherit your context — brief them like new hires.
- **Adversarial review is mandatory.** Before marking any milestone complete, dispatch `qa-red-team` (tries to break it in the running app, mobile viewport first) and — for UI milestones — `design-critic` (audits against `docs/PRODUCT.md`) in parallel. Fix confirmed findings, re-verify, then check the gates. Never let a builder review its own work.
- **Trust but verify.** Treat every subagent report as a claim, not a fact. The lead re-runs the verification loop on integrated results before committing.
- **Right-size the team.** Parallelism serves iteration speed; don't spawn agents for trivial edits, and don't serialize work that has no dependency. Typical wave: 2–4 builders plus reviewers.

## Engineering rules

- Typed domain models for reports, sources, price listings, assumptions, questions, saved searches, share artifacts, polls, and telemetry events. Validate all model output server-side; the frontend receives only the stable report contract.
- Share pages, polls, and telemetry require server-side persistence — never fake them client-side. Local storage is acceptable only for per-device preferences and prototype-stage history.
- Deliberate loading, empty, retry, and error states everywhere. Keyboard accessible controls; correct mobile scrolling and keyboard behavior.
- Every shipped feature emits its telemetry events per `docs/LEARNING.md`. A feature without telemetry is unfinished.

## Commands

Fill this section in during the M0 audit (exact dev/build/typecheck/test/eval commands from the repo), commit it, and keep it current. Until then, discover commands from `package.json` and repo scripts.

```
dev:        (fill in)
build:      (fill in)
typecheck:  (fill in)
test:       (fill in)
browser:    (fill in)
evals:      (fill in)
```

## Loop engineering

All iteration runs as engineered loops. Every loop you run — personally or via a subagent — carries an explicit **loop contract**: a goal, an action, a machine-checkable verification signal, a measurable exit criterion, an iteration budget, and a state file that records progress. "Looks done" is never an exit criterion; a loop without a falsifiable exit criterion may not start.

### The four nested loops

1. **Micro loop** (seconds–minutes): edit → typecheck/lint/unit test. Signal: compiler and tests. Exit: green. Budget: **3 attempts on the same error** — then stop retrying, diagnose differently or change approach, and note it in `docs/DECISIONS.md`. Never brute-force the same fix.
2. **Feature loop** (minutes–hours): define the check first (test, eval case, or scripted app-level verification) → build → run the verification suite below → fix. Exit: the feature's checks pass in the running app and its telemetry events arrive. Budget: if two consecutive iterations don't reduce the failing-check count, the approach is wrong — redesign, don't grind.
3. **Milestone loop** (the wave): parallel builders → integrate → full verification suite → adversarial review (`qa-red-team`, plus `design-critic` for UI) → fix confirmed findings → re-verify → check gates → update the scorecard in `docs/MILESTONES.md` → commit. Exit: every gate checked **and** the milestone's scorecard targets measured and met (or a miss explicitly logged with a decision).
4. **Learning loop** (nightly): digest → ranked problems → improvements → evals → actions log. Exit per cycle: at least one shipped improvement traceable to real usage, evals still green. This loop never exits overall; it is the product's compounding advantage.

### Loop principles

- **Cheapest falsifying signal first.** Typecheck before tests, tests before browser runs, evals before manual review. Never spend an expensive check to learn what a cheap one could have told you.
- **Verification is defined before code.** A feature starts by writing the check that will prove it works; an engine change starts with the eval case it must pass.
- **The ratchet.** Green never regresses: tests, evals, and scorecard results only move forward. Every bug found — by you, a reviewer agent, or the digest — becomes a permanent regression test or eval case before its fix is committed.
- **Progress is measured, not felt.** Each iteration must strictly reduce the failing-check count or produce new information that changes the approach. An iteration that does neither is a signal to stop and rethink, not to go again.
- **Fresh-context resilience.** Any loop may be resumed by a fresh session with no memory. State files are the loop's memory: `docs/MILESTONES.md` (status + scorecard), `docs/DECISIONS.md`, `intelligence/`. Update them at every exit, not at the end of the day.

### Verification suite (the feature/milestone loop's signal)

1. Typecheck and build.
2. Relevant backend and browser tests; golden-query evals if the engine changed.
3. A real search in the running app with a real Gemini response; open at least one source link from the UI.
4. The full loop: home → research → summary → product detail → prices → home; history open and delete.
5. If share surfaces were touched: create a share link, open it logged-out at mobile viewport, verify the social card and the visitor→search call to action.
6. Verify expected telemetry events actually arrived for the flows exercised.
7. Fix failures before moving on. Never claim a feature works without having exercised it in the running app.

## Definition of done

V1 is done when every milestone gate in `docs/MILESTONES.md` is checked and its **V1 scorecard** targets are measured and met, verified in the running app. That file is the single acceptance authority; do not maintain a competing checklist here.
