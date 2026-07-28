# Org Reference — Law Enforcement (LE)

**Source:** Derived from CSM walkthrough transcript (Rui Simão primary voice) + prior session field analysis.

---

## 1. Org Identity

**Org ID:** `org_le`
**Org Name:** Law Enforcement
**Primary stakeholder in transcript:** Rui Simão

---

## 2. What's Different About Their Book

Public sector agencies — police departments, sheriffs, corrections (Rui explicitly excludes corrections and justice from some of his framing, worth confirming). Multi-product accounts are the norm: a single agency may carry body cameras, in-car cameras, TASER, records/software, and eventually 911 integration. Account counts are moderate (~70 per Leana's reference to Rui's book) but complexity per account is high. Engagement model is high-touch. CSMs are often dealing with two very different contacts inside the same account — command staff (chief reporting to city hall, cares about public accountability and outcomes) versus operational frontliners (officers in the field, cares about day-to-day product function). Goals and risks tracked at the product line level need to aggregate cleanly upward to account level for executive reporting.

Health score must be **stable and consistent** across all line sizes — Rui was explicit that executives like JD cannot be expected to interpret different "greens" for different teams. The health score is not configurable per account or per CSM; it should mean the same thing everywhere within LE.

---

## 3. Trigger Preferences

| Trigger | Setting | Reasoning |
|---|---|---|
| `case_blocked` | Enabled, weight 3 | Standard SLA sensitivity appropriate for agency accounts |
| `nps_csat_drop` | Enabled, weight 3 | NPS was Rui's explicit first ask — a primary signal for this org |
| `negative_sentiment` | Enabled, weight 3 | Public sector relationships are long and reputational; sentiment matters |
| `case_aging` | Enabled, weight 2 | Keep default |
| `case_volume_spike` | Enabled, weight 2 | Keep default |
| `no_exec_sponsor` | Enabled, weight 2 | Command staff sponsorship is critical for agency accounts |
| `renewal_stage_behind` | Enabled, weight 2 | Public sector procurement cycles are long; early warning needed |
| `onboarding_stall` | Enabled, weight 2 | Multi-product onboarding is complex; stalls are high risk |
| `onboarding_no_plan` | Enabled, weight 2 | New agency logos need structured plans given product complexity |
| `usage_drop` | Enabled, weight 1 | Relevant but interpret with caution — usage patterns vary by product line |
| `tap_refresh_due` | Enabled, weight 1 | Hardware refresh (body cam, in-car) is a real cycle for LE |
| `growth_mix_stalled` | Enabled, weight 1 | Cross-sell across product lines is a core motion for this segment |
| `renewal_prep_stale` | Enabled, weight 2 | Increase from default — public procurement timelines demand earlier prep |
| `qbr_overdue` | Enabled, weight 1 | QBRs are standard practice for high-touch LE accounts |
| `cadence_gap` | Enabled | Keep default |
| `escalation_opened` | Enabled | Keep default severity scaling |

---

## 4. Timing Preferences

**Case SLA by segment:** Keep defaults (Enterprise=5, Mid-Market=10, SMB=15) — LE accounts tend to fall in Enterprise/Mid-Market bands.

**Cadence by segment:** Keep defaults. High-touch model means Strategic=30 and Enterprise=45 are the most relevant bands.

**Renewal-prep window:** Extend from 60 days to **90 days** — public sector procurement and budget approval cycles are longer than commercial. A renewal within 90 days with no activity in the last 45 days should fire `renewal_prep_stale`.

**QBR threshold:** Keep 90 days default.

**Aging bonus:** Keep default (21 days, +2 points).

---

## 5. Things They Want That Don't Exist Yet

- **Product-line scorecards:** Rui explicitly asked for the ability to track goals, risks, and qualifying information at the product line level (body cam vs TASER vs records), with those scores aggregating up to account-level health. Described as: "if we have product scorecards where CSMs can easily go in and update goals, risks, qualifying information, we can then aggregate that at an account level." This doesn't map to a current trigger — it's a new data layer, but the risk signal it would generate (e.g. a product scorecard goes red) would route to a Usage & Adoption CTA.

- **Contact-level goal tracking:** Rui flagged that goals differ between command staff and operational frontliners within the same agency. A trigger that fires when contact-level goals haven't been updated in a defined window would be useful. Proposed shape: `custom trigger -> cadence category, weight 1`.

- **NPS trend over time (not just drop):** Rui wants NPS to be predictive, not just reactive. A trigger for sustained flat-or-declining NPS trend (not a single drop event) would be more useful than `nps_csat_drop` alone. Proposed shape: `custom trigger -> escalation category, weight 2`.

---

## 6. Example Chat Phrases for This Org

- "We want NPS to be a primary signal — weight it higher than cases"
- "Turn on product scorecard risk tracking"
- "We deal with command staff and field officers separately — we need contact-level goals"
- "Our renewals are public procurement — we need earlier renewal warnings"
- "Don't let QBRs go past 90 days without flagging"
- "Usage drop alone shouldn't tank an account's health — it needs context"
