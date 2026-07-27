# Tally — product experience spec

The standard is the feeling of getting exceptional, independent advice from the most knowledgeable friend a person could ask — one who does the hours of research, understands the person's actual situation, explains the reasoning, and never has a hidden agenda. Tally earns love through usefulness, speed, clarity, taste, intellectual honesty, and agency. It must make hard buying decisions feel lighter, never more overwhelming.

## Success metrics — instrument all from day one, optimize in this order

1. **Decision confidence** — the user acts on the recommendation (saves a pick, opens a retailer link, marks "this settled it").
2. **Share rate** — percentage of completed reports shared or sent to another person.
3. **Viral coefficient (K)** — new sessions arriving via shared reports, public research pages, and decision polls, per active user.
4. **Return rate** — users who run a second research within 30 days.
5. **Time-to-verdict** — seconds from query to a defensible answer. Speed is a feature and a sharing prerequisite.

## Launch categories

Universal by design, but exceptional first in two verticals chosen for both demand and shareability — they dominate "which one should I buy?" conversations in group chats and forums:

1. **Consumer electronics** — phones, laptops, headphones, TVs, gaming gear, cameras, smart-home devices, wearables, routers, monitors, accessories.
2. **Home goods** — vacuums, cookware, mattresses, bedding, air purifiers, furniture, appliances, storage, cleaning tools, lighting, home-office products.

Category focuses, not gender targeting. Adapt to each person's stated need, constraints, experience level, budget, and taste — never assumptions about identity.

### Category playbooks

Never make the user choose a category; infer it, surface the inference as an editable assumption, and apply the playbook. Playbooks are versioned living assets improved from real query telemetry (see `docs/LEARNING.md`).

- **Consumer electronics:** current generation and successor risk, specs that actually matter, ecosystem/compatibility, software support, repairability, reliability, battery/ownership costs, deal history, retailer/warranty experience, use-case performance.
- **Home goods:** materials and safety, size/fit, care requirements, durability, comfort, noise/energy where applicable, real-home review patterns, assembly/delivery/return friction, visual/aesthetic constraints, long-term value.

## Search entry

- One primary search box accepts: product, need, problem, or SKU.
- Never force questions before research begins.
- IP-derived location as the default for price and availability; user-editable.
- Three research modes:
  - **Quick** — approximately 30 seconds.
  - **Full research** — approximately a few minutes.
  - **Deep dive** — the system decides when enough evidence exists; offered after an initial report.

## Live research — visible, useful, editable while it runs

- Open by proposing assumptions inferred from the prompt; the user can affirm, remove, edit, or add immediately, and edits redirect the research live.
- Show the full research plan: completed, currently researching, and upcoming questions. The user can remove planned questions or add suggested/custom ones before they run.
- Show estimated progress, time saved, current source count, and a "best fit so far" as evidence arrives. Show product imagery during research, not only in the final report.
- Preserve mid-research feedback and use it to redirect later work rather than wasting model calls.
- The AI is an expert collaborator, not a black box: translate ambiguity into the important questions, surface what changed the recommendation, invite only high-leverage input.

## Results contract

For a named product: lead with an evidence-backed verdict on that item, then compare against competitive alternatives. For a need: lead with a ranked shortlist.

Every result includes: best fit with a concise why; online and local price range, availability/delivery, rating/review summary, top pros and cons; a comparison page with the top 10 competitors in a readable grid (reviews, price ranges, pros/cons); a price page listing top online and local retailers; live source links and a clear confidence/uncertainty indicator; saved backup picks; visible assumptions changeable without restarting; share, poll, and price-watch actions within reach of the verdict — present, never nagging; navigation home plus save/open/delete of prior searches.

## Lovability principles

- Lead with a clear answer, then make the evidence easy to inspect.
- Favor concise, memorable explanations over exhaustive undigested facts. The bar: a verdict the user can repeat verbatim to a friend.
- Plain language, practical examples; translate specifications into lived consequences.
- Name the one or two factors most likely to change the user's decision.
- Offer one excellent alternative for different priorities, not a list of near-duplicates.
- Never manufacture urgency, false certainty, or a recommendation merely because an item is purchasable.

## Visual direction

Mobile-first, refined editorial design. Home page hierarchy, with exact required strings:

- Centered **Tally** lockup: dark-green serif wordmark, plain spyglass, thin vertical divider, tagline **"Deep product research."**
- Headline exactly: **"Know before you buy."**
- Search placeholder exactly: **"Product, Need, Problem, SKU…"**
- Small example links: **"Try Dyson V12 Detect"** and **"Try best vacuum for pet hair"**.
- Object-only product images (vacuum, dark-green Dutch oven, folded linen bedding) blending into a warm off-white background — not scene photography.
- A clean "Recent research" list below.

Generous whitespace, strong editorial serif display typography, dark forest-green ink, warm paper background, restrained rust-orange accents. Never a generic dashboard or glossy AI aesthetic. Share pages, social cards, and screenshot surfaces carry this same identity — recognizable in a feed at thumbnail size; the aesthetic is part of the growth loop.
