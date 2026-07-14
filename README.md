# Axon CS Command Center

A standalone, dark-themed rebuild of the Axon Customer Success Command Center — a
lightweight, Gainsight-style renewal/health dashboard. Originally built as a Claude
Cowork artifact reading Salesforce through Cowork's MCP bridge; this version runs as
a normal local web app with its own backend, so it works outside Cowork too.

## What's here

- `backend/` — a small FastAPI server. It exposes one generic endpoint,
  `POST /api/soql`, that runs a SOQL query and returns `{records: [...]}`. It also
  serves the frontend.
- `frontend/` — `index.html` is a small title/landing page (logo, tagline, an "Enter
  Command Center" button); the actual dashboard lives at `app.html` (`styles.css`,
  `app.js`). All the scoring, success-plan, CTA, journey, escalation and
  org-drilldown logic from the original artifact is preserved as-is; only the
  transport (how it fetches data) and the visual theme changed.
- `NOTES.md` — design notes distilled from a conversation with an Axon enterprise CS
  leader, with attributed quotes, and exactly which features in this app trace back to
  that guidance (4-metric CSM Scorecard, engagement cadence, blocked/aging Case Watch,
  Resource Library, health-score skepticism, and the custom Salesforce fields this app
  assumes).

## Features (everything this version currently does)

### Landing page
- `index.html` — logo, tagline, a single "Enter Command Center →" button into `app.html`.

### Global / every tab
- **Mock data / Live Salesforce** badge in the header, plus an "As of [timestamp]" stamp so it's always clear how fresh the data is.
- **"View as [CSM]"** dropdown — filters the entire app (every tab, every chart) down to one CSM's book, session-only.
- **Org Drill-down scope** — most tabs respect whatever team/manager/CSM you've scoped to via Org Drill-down, shown as a "Scope: ___" breadcrumb.
- Clickable KPI tiles throughout — clicking one both filters the table below it and, on Home/Overview, jumps straight to the relevant tab.

### Home
- Headline KPIs, deliberately ordered to lead with **engagement rate, growth (organic/expansion/transactional), customer insights logged, and Book NPS** before ARR/health — per CS-leadership guidance (see `NOTES.md`).
- Book-health donut chart (healthy / watch / at-risk) and a "new logos to onboard" callout linking straight to Success Plans.
- A card of every feature area with a one-line description — click any card to jump to that tab.

### Command Center (Overview)
- Scoped KPI row: engagement, growth, renewal ARR, ARR at risk, avg health, NPS in scope, open escalations.
- Renewal ARR by team chart + book health distribution chart.
- **Top risk-weighted accounts** table (renewal ARR × risk) with CSAT, NPS, health and ARR-at-risk columns — click any row to open Account 360.

### Org Drill-down
- Walks the exec → director → manager → CSM → account hierarchy, with ARR/risk roll-ups computed live at every level.
- Click into any node to re-scope the whole app to that team/person.

### Renewals
- Every open renewal opportunity, sorted by revenue exposure, with stage, close date, lifetime value, open cases, CSAT, renewal readiness score, and ARR at risk.
- Flags deals that are "behind" — close date inside 90 days but still in an early sales stage.

### CSM Scorecard
- The 4 metrics an enterprise CS org is actually run on (per CS-leadership guidance): **customer insights, engagement rate, and growth split into organic/renewal, expansion, and transactional** — not one lump health score.
- Editable, persisted **targets** per metric with progress bars per CSM.
- **NPS column** — per-CSM promoter-minus-detractor rollup from real (mocked) biannual survey responses.
- **Overdue items column** — count of open CTAs + Success Plan milestones past their due date, worst-first; click it to open a **coaching drill-down** showing exactly which items are overdue and how overdue, with one-click jump to the account or plan (added per Leana's "see where a CSM is stuck" ask — see `NOTES.md`).

### CTAs (Calls to Action)
- Auto-suggested action items (onboarding, renewal, TAP refresh, CS request, risk, adoption) generated from live account signals, plus manually-added ones.
- KPI tiles for open / high-priority / overdue CTAs; start/complete/reopen workflow; persists in `localStorage`.

### Escalations
- Auto-seeded from live risk signals (health, cases, sentiment), with severity (Critical/High/etc.), status (Open → In Progress → Resolved, reopenable), and a timestamped note log per account.
- KPI tiles (critical unresolved / open / in progress / resolved) double as filters; **Start** and **Resolve** buttons update status and re-render immediately.

### Case Watch
- Splits open cases into the two buckets a CSM actually needs to act on: **blocked** ("it's not happening") vs. **aging** ("it's been open too long") — deliberately not merged into one queue, per CS-leadership guidance.
- KPI tiles filter the table; each row links to Account 360.

### Engagement
- Required outreach cadence by book segment (Strategic/Enterprise/Mid-Market/SMB), each with its own required touch frequency.
- Flags accounts that are out of cadence or due soon, sorted most-overdue-first.

### Success Plans
- Auto-generates a milestone-based onboarding/risk plan for any account (new-logo or at-risk), or build a fully custom plan.
- Editable objectives, milestones (with due dates and done-state), and freeform notes — all persisted per account.

### Journeys
- Four lifecycle outreach journeys (New Logo Welcome, Renewal 90-Day, At-Risk Save Play, Product Adoption Nudge) with membership **auto-derived from live account signals**.
- Per-account progress tracking (Not started / In progress / Done). Emails themselves send from your real outreach tool — this tab orchestrates and tracks, it doesn't send mail.

### My Worklist
- A single prioritized action list across your whole scope — renewals stuck in early stage close to their date, open high/urgent cases, unplanned new logos, strained sentiment, large at-risk renewals, and "get ahead" nudges — ranked by urgency then revenue.

### Health Model
- Transparent, tunable health-score weights (per open case, per high/urgent case, renewal proximity, early-stage risk, stale engagement) — every account starts at 100 and these subtract live.
- Explicitly de-emphasized as the headline metric, with an in-app callout explaining why (see `NOTES.md`).

### Resource Library
- Editable, topic-tagged library of guides/SOPs (onboarding, RMAs, training, use cases, renewal recaps) that link to real, working pages under `frontend/resources/` — not placeholder links. Anyone can add/edit entries in real time.

### Account 360 (account detail view)
Opens as an overlay from anywhere in the app. Includes:
- KPI strip: Health, CSAT, **NPS**, Sentiment, Lifetime value, Renewal ARR, Open cases, Blocked/Aging cases, all-time Growth.
- **"Who's on this account"** — an editable roster of every role touching the account, both **Axon-side** (CSM, TAM, engagement specialist, fleet installer, etc.) and **customer-side** contacts, so nobody has to guess who to talk to (added per Mark's "biggest issue with customers" finding — see `NOTES.md`).
- CSAT card (placeholder, manually settable) and renewal-readiness checklist.
- Purchase history & lifetime value, products purchased by spend.
- **Customer Insights** log — freeform notes on what the team is learning about the account, rolled up into the CSM Scorecard.
- Resources & guides (read-only view into the Resource Library), customer sentiment breakdown, full health-score breakdown, open renewals, recent communications (tasks/events), and the same Escalation status/notes workflow as the Escalations tab.

By default the backend runs in **mock mode**: it generates a realistic, internally
consistent synthetic book of ~64 accounts (renewals, org hierarchy, support cases,
closed-won deals & products, communications) so the whole app is fully interactive
immediately, with no setup. You can point it at your real Axon Salesforce org later —
see below.

## Running it

Easiest: double-click `start.bat` in this folder. It creates a virtual environment,
installs dependencies, copies `.env.example` to `.env` if needed, and opens
`http://127.0.0.1:8420` in your browser.

Manually:

```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8420
```

Then open `http://127.0.0.1:8420`.

## Sharing it with a teammate on your network

Easiest option if a teammate can clone this repo themselves: they just run
`start.bat` on their own machine — no coordination needed, and each person gets
their own independent instance (handy since mock data is deterministic anyway).

If instead you want them to view the copy running on **your** PC (same office/
Wi-Fi/VPN), double-click **`start-shared.bat`** instead of `start.bat`. It's
identical, except it binds the server to all network interfaces instead of only
`127.0.0.1`, and prints a URL to share, e.g. `http://192.168.1.42:8420`. Notes:

- Windows may show a one-time firewall prompt for Python/uvicorn — click **Allow
  access** (at least for private networks). If you don't see a prompt and your
  teammate can't connect, you likely need an inbound firewall rule:
  ```powershell
  New-NetFirewallRule -DisplayName "Axon CS Command Center" -Direction Inbound -Protocol TCP -LocalPort 8420 -Action Allow
  ```
  (run in an elevated/admin PowerShell).
- It's only reachable by other devices on the **same network** as your PC, and
  only for as long as that terminal window stays open and your PC is awake.
- Don't use this to share a **live Salesforce** session (`DATA_MODE=salesforce`)
  on a network you don't fully trust — anyone who can reach the URL can browse
  that data. It's intended for the default mock-data mode.

## Switching to live Salesforce data

You only need your normal Salesforce login — no Connected App required. The backend
uses `simple-salesforce`'s SOAP username/password/security-token login flow.

1. Get a security token if you don't already have one: in Salesforce, click your
   avatar → **Settings** → **My Personal Information** → **Reset My Security Token**
   (it emails you a new one).
2. Edit `backend/.env`:

   ```
   DATA_MODE=salesforce
   SF_USERNAME=you@axon.com
   SF_PASSWORD=your-password
   SF_SECURITY_TOKEN=the-token-from-step-1
   SF_DOMAIN=login
   ```

   Use `SF_DOMAIN=test` for a sandbox, or your My Domain prefix if your org requires
   one for login.
3. Restart the backend (`start.bat` again, or re-run `uvicorn`).
4. The header badge should switch from "Mock data" to "Live Salesforce". If it falls
   back to mock with a note that Salesforce isn't configured, double-check the values
   in `.env` and the backend's terminal output for the login error.

If your org has disabled the SOAP login API entirely, this flow will fail outright —
in that case you'd need a Connected App with the OAuth username-password flow instead
(a small change to `backend/app/salesforce_client.py`); ask for that if you hit this.

Nothing on the frontend needs to change either way — it always calls the same
`/api/soql` endpoint and gets back the same `{records: [...]}` shape, whether the
answer came from the mock engine or your real org.

### Data-sourcing guidance (from Axon CS leadership)

- **Salesforce should stay the system of record.** This app is meant to be a workflow
  layer in front of Salesforce, not a second source of truth — treat the
  `localStorage`-backed features (success plans, CTAs, escalation notes, customer
  insights, resource library, CSM targets) as placeholders for real Salesforce fields
  once they exist, not a permanent home for that data.
- **Product data is read-only** — it comes from the product team's systems, not
  Salesforce, and should never be written back to.
- **NPS/CSAT**: NPS is realistically sourceable today from Salesforce (there's an NPS
  dashboard) or from Snowflake (Nova Sales). There is currently no CSAT process for
  Customer Success specifically (Support may have one) — so CSAT in this app will
  likely need to stay a placeholder longer than NPS would. If you want to wire in
  real NPS, that's the better near-term target.
- A few fields this app's mock engine invents (`Account.Segment`, case
  blocked/aging flags, `Opportunity.GrowthType__c`) don't exist on a stock Salesforce
  org — see **`NOTES.md`** for exactly which queries need a custom field or a
  derivation rule to return real data instead of an empty result once you flip to
  live Salesforce.

## Notes

- All of the interactive state a CSM creates in the app — success plans, CTAs,
  escalation notes, journey progress, CSAT overrides, health-model weights, customer
  insights, the resource library, and CSM Scorecard targets — is saved in the
  browser's `localStorage`, exactly like the original artifact. It is not sent to
  Salesforce or the backend.
- Mock data is deterministic (seeded), so it looks the same across restarts unless you
  change `MOCK_SEED` or `MOCK_ACCOUNT_COUNT` in `backend/.env`.
- CSAT is a placeholder everywhere (mock and live) until a real survey/CSAT data
  source is wired in — this mirrors the original artifact's behavior.
- The default Resource Library entries link to real, written reference pages under
  `frontend/resources/` (an onboarding SOP, an RMA guide, a training catalog, a
  use-case playbook, and a renewal value-recap template) — not placeholder links.
  They're served by this same backend at `/assets/resources/...`, so they open and
  work out of the box; edit those `.html` files directly, or add your own resources
  from the Resource Library tab.
