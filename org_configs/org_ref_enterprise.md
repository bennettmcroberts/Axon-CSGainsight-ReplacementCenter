# Org Reference — Enterprise

**Source:** Derived from CSM walkthrough transcript (Leana Hart primary voice for management layer; Derek Frer for larger account dynamics) + prior session field analysis.

---

## 1. Org Identity

**Org ID:** `org_enterprise`
**Org Name:** Enterprise
**Primary stakeholder in transcript:** Leana Hart (management/director lens)

---

## 2. What's Different About Their Book

Larger strategic private-sector accounts. Leana references "majors" with books of ~30 accounts at the CSM level — smaller book, higher complexity, white-glove engagement. Her management use case is explicit: she wants to look across a CSM's book and immediately see which accounts are red, why they are red, what triggered it, what actions are being taken, and when the next conversation is scheduled. The system needs to support that manager interrogation layer, not just the CSM view.

The health score should be **data-driven but overridable** — Leana's position is that the science surfaces the flag, the CSM has the autonomy to override it with documented context. She does not want CSMs discovering churn risk only when it becomes a "5 alarm fire." Proactive alerting is the dominant ask from this org.

ROI and value demonstration become more important at this tier — larger accounts have the sophistication to ask "did I get value for money" and the relationship depth to have meaningful conversations about it at renewal.

---

## 3. Trigger Preferences

| Trigger | Setting | Reasoning |
|---|---|---|
| `case_blocked` | Enabled, weight **4** | Increase — enterprise accounts have low tolerance for stuck cases; faster escalation warranted |
| `nps_csat_drop` | Enabled, weight 3 | Keep default — NPS is a meaningful signal at this tier |
| `negative_sentiment` | Enabled, weight 3 | Keep default — relationship depth means sentiment signals are reliable |
| `case_aging` | Enabled, weight **3** | Increase — enterprise SLA expectations are tighter |
| `case_volume_spike` | Enabled, weight 2 | Keep default |
| `no_exec_sponsor` | Enabled, weight **3** | Increase — executive sponsor is critical for renewal and expansion at this tier |
| `renewal_stage_behind` | Enabled, weight **3** | Increase — enterprise renewals are high-stakes; early warning is essential |
| `onboarding_stall` | Enabled, weight 2 | Keep default |
| `onboarding_no_plan` | Enabled, weight 2 | Keep default |
| `usage_drop` | Enabled, weight 1 | Keep default — relevant but context-dependent |
| `tap_refresh_due` | Enabled, weight 1 | Keep default |
| `growth_mix_stalled` | Enabled, weight **2** | Increase — expansion is a primary motion for enterprise accounts |
| `renewal_prep_stale` | Enabled, weight **3** | Increase — Leana's explicit ask: never be surprised at renewal |
| `qbr_overdue` | Enabled, weight 1 | Keep default — QBRs are standard at this tier |
| `cadence_gap` | Enabled | Keep default |
| `escalation_opened` | Enabled | Keep default severity scaling |

---

## 4. Timing Preferences

**Case SLA by segment:** Tighten Enterprise SLA from 5 days to **3 days** — Leana's "5 alarm fire" framing implies enterprise accounts need faster case response flagging.

**Cadence by segment:** Keep defaults. Strategic=30 and Enterprise=45 are the primary bands.

**Renewal-prep window:** Extend to **90 days** — enterprise renewals involve procurement, legal, and executive sign-off; 60 days is too late to course-correct.

**QBR threshold:** Tighten to **60 days** — Leana wants regular, structured touchpoints with enterprise accounts.

**Aging bonus:** Keep default (21 days, +2 points).

---

## 5. Things They Want That Don't Exist Yet

- **Manager interrogation view:** Leana's explicit ask — when she looks at a CSM's book she wants to see which accounts are red, what triggered each one, what actions are open, and when the next conversation is scheduled. This is more of a UI/reporting layer than a new trigger, but the data it needs (trigger reason, open CTAs, next scheduled touch) all exists today. Worth flagging as a display requirement for this org's command center view.

- **CSM override with documentation:** When the system flags an account as at-risk and the CSM disagrees (e.g. usage looks bad but account is actually healthy), CSM should be able to override the signal, log the reason, and have that context visible to the manager. Proposed shape: not a trigger — a disposition field on the account that sits alongside the automated risk score.

- **Proactive renewal health signal:** A trigger that fires not just when renewal is close but when the *combination* of signals (no QBR in 60 days + no exec sponsor + renewal within 90 days) suggests the account is at renewal risk before it's formally "behind." Proposed shape: composite custom trigger -> renewal category, weight 3.

- **ROI / value-over-time tracking:** Derek articulated this clearly — success plans should reflect what the customer wanted to get out of the system, and the CSM should be able to show cumulative value delivered at renewal. Not a trigger per se, but a trigger for "success plan has no documented outcomes" would be a useful signal. Proposed shape: `custom trigger -> usage category, weight 1`.

---

## 6. Example Chat Phrases for This Org

- "I want to know the moment an account starts showing risk, not when it's already on fire"
- "Case blocked on an enterprise account should escalate faster than default"
- "I need to see across my team's books — who has red accounts and what's being done"
- "Renewal warnings need to come earlier — 90 days out minimum"
- "QBRs should be flagged if they go past 60 days"
- "CSMs should be able to override a risk flag if they have context"
- "Weight executive sponsor missing higher — that's a serious gap for us"
