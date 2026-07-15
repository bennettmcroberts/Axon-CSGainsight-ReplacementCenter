# Axon CS Command Center — Executive Summary

## What it is

An internal, purpose-built replacement for Gainsight: a single live dashboard for
Customer Success that pulls renewal, health, case, and purchase data out of
Salesforce and turns it into the workflows a CS org actually runs on — instead of
a generic overlay bolted on top. It runs as a normal local web app (its own
lightweight backend + browser frontend), so anyone on the team can run it with no
special setup.

**Today it runs on realistic mock data** (a synthetic book of ~64 accounts) so it's
fully interactive out of the box. It can be pointed at a real Salesforce login
later with a config change — no frontend code changes required either way.

## Why this exists instead of Gainsight

Built directly from feedback from CS leadership and CSMs who had deployed and
abandoned Gainsight: it was slow to change, code-heavy, and built for a generic
"sales + marketing automation" motion rather than the blended
service/sales/support/account-management job CS actually does. The guiding
principle here: don't just re-skin what's already in Salesforce — add real
leverage (cadence tracking, blocked/aging case triage, a resource library,
coaching visibility, etc.) that people can't already get elsewhere.

## What it does today

**Portfolio visibility**
- **Home** — headline metrics ordered the way CS is actually run: engagement rate,
  growth (organic / expansion / transactional), customer insights logged, and
  Book NPS — with health/ARR as supporting context, not the star of the show.
- **Command Center, Org Drill-down, Renewals** — book-level KPIs and charts, a
  click-through exec → team → CSM → account hierarchy, and a revenue-prioritized
  renewal/risk triage table.
- **Account 360** — a one-stop detail view for any account: health, CSAT, NPS,
  sentiment, lifetime value, "who's on this account" (both Axon-side and
  customer-side contacts), purchase history, communications, and every
  workflow tool below, all in one overlay.

**Action & workflow tools**
- **CSM Scorecard** — the four metrics CS leadership actually pays/rates on
  (insights, engagement, and the three growth types), with editable targets and
  a manager coaching drill-down showing exactly which CTAs/milestones are overdue
  and by how much.
- **CTAs** — auto-suggested and manual action items (onboarding, renewal, TAP
  refresh, CS request, risk, adoption) with a start/complete workflow.
- **Escalations** — auto-seeded from live risk signals, now tracked distinctly
  from routine tickets with a reason code, product tag, a standardized
  6-step actionable checklist, days-open/staleness tracking, and a leadership
  rollup view across the whole portfolio.
- **TAP Refreshes** — a dedicated tab tracking hardware warranty refresh cycles
  (due at the 2.5-year mark of a 5-year hardware contract), with a
  standardized per-account checklist from inventory check through close-out.
- **Case Watch** — the two case signals worth escalating before they become an
  executive email: blocked cases and aging cases, kept as separate queues.
- **Engagement** — required outreach cadence by book segment, flags who's
  falling out of cadence.
- **Success Plans** — auto-generated onboarding/risk plans per account, now
  including a standardized "deal & account discovery" template (purchasing
  story, stakeholders, blockers, politics, SLA info, etc.) so every plan
  captures the same context regardless of who owns the account.
- **Journeys** — lifecycle outreach tracking (welcome, renewal, save play,
  adoption) with auto-derived membership.
- **My Worklist** — one prioritized action list ranked by urgency and revenue, including open/overdue next steps reps documented on accounts.
- **Activity & next steps (Account 360)** — reps can log calls/emails/meetings/notes and capture the next action with a due date, so past outreach and “what happens next” stay current without waiting on Salesforce write-back.

**Configuration**
- **Health Model** — transparent, tunable health-score weights; the whole book
  re-scores instantly with no engineering ticket.
- **Resource Library** — an editable, topic-tagged library of guides/SOPs that
  anyone can update in real time, surfaced on every Account 360 page too.

## How it's built (for context, not action needed)

- Backend: a small FastAPI server with one endpoint that runs a SOQL-style query
  and returns records — either from the built-in mock data engine or, once
  configured, a real Salesforce login.
- Frontend: a single-page app (no framework) that calls that endpoint and
  renders everything client-side.
- Anything a CSM creates in-app today (success plans, CTAs, escalation notes,
  journey progress, insights, targets) is saved in the browser's `localStorage`
  — it's meant as a placeholder for real Salesforce fields, not a permanent home
  for that data, so it won't yet sync across teammates or devices.

## Known limitations / not yet built

- **CSAT is a placeholder everywhere** — there's no CS-specific CSAT survey
  process today, so it's derived from support sentiment rather than real
  survey data. NPS, by contrast, is real (biannual survey).
- **State is local to each person's browser** for now — plans, CTAs, and
  escalation notes don't sync between teammates until this is wired into real
  Salesforce objects.
- Several corroborated but not-yet-built asks (adoption/APAP scoring,
  playbook-per-task links, configurable auto-CTA thresholds, a full rules
  engine) are intentionally deferred — see `NOTES.md` for the full reasoning
  and prioritization.

## Where to go for more detail

- `README.md` — full feature-by-feature breakdown, plus setup/run instructions
  and how to point the app at live Salesforce data.
- `NOTES.md` — the stakeholder research and CS-leadership guidance behind why
  each feature exists (and what was deliberately left out, and why).
