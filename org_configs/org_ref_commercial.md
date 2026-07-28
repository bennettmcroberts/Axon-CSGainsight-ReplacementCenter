# Org Reference — Commercial

**Source:** Derived from CSM walkthrough transcript (Derek Frer primary voice) + prior session field analysis.

---

## 1. Org Identity

**Org ID:** `org_commercial`
**Org Name:** Commercial
**Primary stakeholder in transcript:** Derek Frer

---

## 2. What's Different About Their Book

Private sector, retail and enterprise commercial accounts. Derek's book spans SMB through strategic — he references managing Walmart-tier accounts alongside Jen's SMB business. This creates a wide range of expectations within the same org: a support case that would be a same-day emergency on a large account might sit for days without concern on an SMB. The system must respect that range rather than applying uniform thresholds.

Derek is the strongest skeptic of automated health scores in the transcript — he considers them "vanity more times than not" and has been burned by tools like Gainsight where CSMs end up doing a part-time job just maintaining the score. His preferred model is **account disposition** (healthy / neutral / at-risk / escalated) set by the CSM, combined with specific trigger-driven signals. The automated score should not be the primary indicator for this org.

Usage metrics are explicitly unreliable as a standalone health signal here — Derek gives the example of usage looking low while the account is perfectly healthy because the core outcome (e.g. stopping shrinkage) has been achieved. Usage drop should have lower weight and should not trigger escalation directly.

Revenue is best viewed as **Total Contract Value (TCV)** at a 3-year cap — Derek was specific that commercial entities buy on 3-year terms and displaying 5 or 10-year booking amounts is misleading for this book.

Pain points and customer goals should be **sourced from opportunity data** and made editable over time — Derek's example: initial pain point was workplace violence, three years later it's warehouse theft. The system should seed from Salesforce and let CSMs update as relationships evolve.

---

## 3. Trigger Preferences

| Trigger | Setting | Reasoning |
|---|---|---|
| `case_blocked` | Enabled, weight 2 | Reduce from default 3 — threshold sensitivity varies dramatically by account size; let SLA by segment do the heavy lifting |
| `nps_csat_drop` | Enabled, weight 1 | Reduce — NPS is less consistently measured across commercial/SMB accounts; lower signal reliability |
| `negative_sentiment` | Enabled, weight 2 | Keep near default — sentiment is still meaningful at larger commercial accounts |
| `case_aging` | Enabled, weight 2 | Keep default — but SLA thresholds (see below) do the segmentation |
| `case_volume_spike` | Enabled, weight 2 | Keep default |
| `no_exec_sponsor` | Enabled, weight 1 | Reduce — SMB accounts often don't have a formal exec sponsor; shouldn't fire as a routine risk signal |
| `renewal_stage_behind` | Enabled, weight 2 | Keep default |
| `onboarding_stall` | Enabled, weight 2 | Keep default |
| `onboarding_no_plan` | Enabled, weight 2 | Keep default |
| `usage_drop` | Enabled, weight **0.5** | Significantly reduce — Derek explicit that usage can look bad while account is healthy (ROI achieved, outcome delivered). Should surface as a soft signal only, never drive escalation on its own |
| `tap_refresh_due` | Enabled, weight 1 | Keep default — hardware refresh cycles are relevant for commercial/retail |
| `growth_mix_stalled` | Enabled, weight **2** | Increase — cross-sell and expansion (e.g. drone for commercial enterprise) is a key motion |
| `renewal_prep_stale` | Enabled, weight 2 | Keep default |
| `qbr_overdue` | Enabled, weight 1 | Keep for larger accounts; consider disabling for SMB tier |
| `cadence_gap` | Enabled | Keep default |
| `escalation_opened` | Enabled | Keep default severity scaling |

---

## 4. Timing Preferences

**Case SLA by segment:** Widen SMB threshold significantly — Derek's exact framing was that an SMB case can sit for "days before we care," while a Walmart-level account should flag same-day. Proposed: Enterprise=**2**, Mid-Market=7, SMB=**21**.

**Cadence by segment:** Widen SMB cadence — low-touch digital model for SMB means longer gaps are expected. Proposed: Strategic=30, Enterprise=45, Mid-Market=60, SMB=**120**.

**Renewal-prep window:** Keep 60-day default — commercial procurement moves faster than public sector.

**QBR threshold:** Keep 90-day default for larger accounts. For SMB, QBR cadence is less formal — consider disabling `qbr_overdue` for accounts tagged SMB.

**Aging bonus:** Keep default (21 days, +2 points).

---

## 5. Things They Want That Don't Exist Yet

- **Account disposition field (CSM-set):** Derek's core ask — healthy / neutral / at-risk / escalated, set and moved by the CSM manually. This sits alongside automated risk scoring and is the primary prioritization tool for his team. Not a trigger, but a field that influences worklist sort order. Worth flagging as a required display/data field for this org.

- **ROI / value-over-time tracking:** Derek was explicit — "the success plan should reflect what the customer wants to get out of the system... did I get value for money? That's when they renew and expand." A trigger for success plans with no documented outcomes or no ROI notes after 90 days of go-live would surface this. Proposed shape: `custom trigger -> usage category, weight 1`.

- **Auto-generated goals for SMB:** Derek described doing this at Catalyst — for SMB accounts where the customer can't articulate goals and interaction is low-touch, the system generates a standard set of expected outcomes as a starting point. Not a trigger, but a success plan generation feature for accounts tagged SMB with no goals on file.

- **3-year TCV view:** Revenue display capped at 3-year booking value for this org. Not a trigger — a display/field configuration preference. Flag for the field registry.

- **Drone data gap flag:** Derek noted drone data currently lives outside the Axon product warehouse. A soft flag on accounts with drone products indicating "usage data unavailable — verify manually" would prevent the system from incorrectly treating missing drone usage as a usage drop. Proposed shape: `custom trigger -> manual category, weight 0` (informational only, no risk contribution).

---

## 6. Example Chat Phrases for This Org

- "Usage drop shouldn't mean the account is at risk — turn that signal way down"
- "SMB accounts don't need same-day case flagging — give them more time"
- "We don't always have exec sponsors on small accounts — stop flagging that"
- "I want CSMs to be able to set their own account status — healthy, neutral, at-risk, escalated"
- "QBRs aren't a thing for our SMB book — turn that off for small accounts"
- "We track revenue as TCV on 3-year deals, not ARR"
- "Pain points from sales should come over automatically and CSMs can edit them"
