# Org Reference — Axon 911

**Source:** Derived from CSM walkthrough transcript (Leana Hart named this as a distinct team; Rui Simão's framing of public-sector customer journey applies here) + prior session field analysis. Note: no dedicated 911 CSM spoke in the transcript — inferences below are grounded in what was said about the product and customer type, and flagged where they are assumptions to validate.

---

## 1. Org Identity

**Org ID:** `org_911`
**Org Name:** Axon 911
**Primary stakeholder in transcript:** Not directly represented — Leana named the team, Rui's public-sector framing is the closest proxy.

---

## 2. What's Different About Their Book

Dispatch and 911 call center agencies — a distinct public-safety vertical from field law enforcement. The product (CAD/dispatch software) is deeply operationally embedded, meaning downtime or degraded performance has immediate public safety consequences. This makes case response and escalation sensitivity higher than almost any other segment. Accounts are likely mid-to-large public agencies, similar procurement model to LE (public sector budget cycles, city/county government buyers).

The customer journey framework Rui described applies here — health reporting should be consistent with LE so executives can read both without translation. Engagement model is likely high-touch given the operational criticality of the product.

Key difference from LE: the product set is narrower (focused on 911/dispatch rather than multi-product body cam/TASER/records), so product scorecard complexity is lower. However, the operational stakes per account are higher — a dispatch system outage is a public safety incident, not just a support ticket.

**Note:** Several fields below (QBR cadence, exec sponsor patterns, contact structure) are inferred rather than directly stated. These should be validated with the 911 CSM team lead before finalizing.

---

## 3. Trigger Preferences

| Trigger | Setting | Reasoning |
|---|---|---|
| `case_blocked` | Enabled, weight **4** | Increase significantly — a blocked case on a 911 system is operationally critical; cannot sit |
| `nps_csat_drop` | Enabled, weight 3 | Keep default — NPS is meaningful for public-sector operational tools |
| `negative_sentiment` | Enabled, weight **4** | Increase — negative sentiment from a 911 agency carries reputational and public-safety weight |
| `case_aging` | Enabled, weight **3** | Increase — case aging in this context has public safety implications |
| `case_volume_spike` | Enabled, weight **3** | Increase — a spike in cases on a 911 system is a high-urgency signal |
| `no_exec_sponsor` | Enabled, weight 2 | Keep default — executive sponsor (dispatch director, IT director) is important |
| `renewal_stage_behind` | Enabled, weight 2 | Keep default |
| `onboarding_stall` | Enabled, weight **3** | Increase — 911 system onboarding stalls have operational go-live risk |
| `onboarding_no_plan` | Enabled, weight **3** | Increase — same reason; new 911 logos need airtight success plans |
| `usage_drop` | Enabled, weight **2** | Increase from default — usage drop on a 911 system is a stronger signal than on most products (system may not be functioning correctly) |
| `tap_refresh_due` | Enabled, weight 1 | Keep — hardware refresh relevant if any physical infrastructure is involved |
| `growth_mix_stalled` | Enabled, weight 1 | Keep default — cross-sell is less of a primary motion for this narrower product |
| `renewal_prep_stale` | Enabled, weight **3** | Increase — public procurement cycles; same logic as LE |
| `qbr_overdue` | Enabled, weight 1 | Keep default |
| `cadence_gap` | Enabled | Keep default |
| `escalation_opened` | Enabled | Keep default severity scaling — but Critical severity escalations on this org should probably notify up the chain automatically |

---

## 4. Timing Preferences

**Case SLA by segment:** Tighten across the board — 911 systems have no tolerance for stuck cases. Proposed: Enterprise=**2**, Mid-Market=**5**, SMB=10.

**Cadence by segment:** Keep defaults. These are high-touch accounts — Strategic=30 and Enterprise=45 are the relevant bands.

**Renewal-prep window:** Extend to **90 days** — same public-sector procurement logic as LE.

**QBR threshold:** Keep 90-day default.

**Aging bonus:** Consider reducing aging window from 21 to **14 days** — triggers on 911 accounts should escalate faster when unresolved.

---

## 5. Things They Want That Don't Exist Yet

- **Operational incident flag:** A trigger that distinguishes between a standard support case and a system-affecting operational incident (e.g. CAD outage, dispatch disruption). These should route directly to escalation at Critical severity regardless of the automated score. Proposed shape: `custom trigger -> escalation category, weight 6` (matching Critical severity).

- **Go-live readiness signal:** During onboarding, a trigger that fires if key go-live milestones (training completion, data migration sign-off, UAT approval) haven't been logged within expected windows. Proposed shape: `custom trigger -> usage category, weight 2`.

- **Renewal alignment with city/county budget cycles:** Public agencies budget on fiscal year cycles (often July 1 or January 1). A renewal prep trigger that accounts for budget cycle timing rather than just contract end date would reduce false-negatives where the contract auto-renews but budget wasn't secured in time. Proposed shape: custom field on account -> feeds into `renewal_stage_behind` threshold logic.

---

## 6. Example Chat Phrases for This Org

- "A blocked case on a 911 system is an emergency — weight it higher"
- "Case volume spike means something is wrong with the system — flag it immediately"
- "Usage drop is more serious for us than for other teams — increase that weight"
- "Onboarding stalls are a public safety risk — we need earlier warnings"
- "Our renewals are public procurement — 90-day prep window minimum"
- "We need to distinguish between a regular support case and an operational incident"
