# Org Reference — International

**Source:** Derived from CSM walkthrough transcript (Rui Simão raised international as a fifth distinct team; Leana confirmed it) + prior session field analysis. Note: international was the most briefly discussed of the five — several fields below are inferred and should be validated with the international team lead.

---

## 1. Org Identity

**Org ID:** `org_international`
**Org Name:** International
**Primary stakeholder in transcript:** Rui Simão (raised the need; no dedicated international CSM spoke)

---

## 2. What's Different About Their Book

Public safety and law enforcement accounts outside the US. Rui's specific flag: "certain playbooks that would be applicable in the US could be illegal somewhere else — we need to make sure we are separating these waters." This is the most operationally distinct team from a compliance standpoint. The customer journey and health reporting framework should align with LE and 911 (consistent health score for upward reporting), but playbooks, engagement models, and certain trigger behaviors need to be filtered by jurisdiction.

Account mix is likely similar to LE — public agencies, multi-product, high-touch — but with the additional layer of language, legal, and cultural variation. Procurement models vary significantly by country. Some markets may be earlier in the Axon product adoption curve, making onboarding and adoption signals more prominent than renewal signals.

---

## 3. Trigger Preferences

| Trigger | Setting | Reasoning |
|---|---|---|
| `case_blocked` | Enabled, weight 3 | Keep default — case SLA sensitivity appropriate for agency accounts |
| `nps_csat_drop` | Enabled, weight 3 | Keep default — NPS measurement may be less consistent internationally but still valuable |
| `negative_sentiment` | Enabled, weight 3 | Keep default |
| `case_aging` | Enabled, weight 2 | Keep default |
| `case_volume_spike` | Enabled, weight 2 | Keep default |
| `no_exec_sponsor` | Enabled, weight 2 | Keep default — executive sponsorship is important but contact structures vary internationally |
| `renewal_stage_behind` | Enabled, weight 2 | Keep default — adjust per-account based on country procurement cycle |
| `onboarding_stall` | Enabled, weight **3** | Increase — international markets may be earlier in adoption; onboarding quality is critical |
| `onboarding_no_plan` | Enabled, weight **3** | Increase — same reason |
| `usage_drop` | Enabled, weight 1 | Keep default |
| `tap_refresh_due` | Enabled, weight 1 | Keep default |
| `growth_mix_stalled` | Enabled, weight 1 | Keep default — cross-sell motion exists but may be slower in newer markets |
| `renewal_prep_stale` | Enabled, weight 2 | Keep default — flag for extension in markets with longer procurement cycles |
| `qbr_overdue` | Enabled, weight 1 | Keep default |
| `cadence_gap` | Enabled | Keep default |
| `escalation_opened` | Enabled | Keep default severity scaling |

---

## 4. Timing Preferences

**Case SLA by segment:** Keep defaults as a starting point — validate with international team lead whether case response expectations differ meaningfully by region.

**Cadence by segment:** Keep defaults. High-touch model assumed for international agency accounts.

**Renewal-prep window:** Extend to **90 days** — international procurement timelines are often longer and less predictable than US, especially in government markets.

**QBR threshold:** Keep 90-day default.

**Aging bonus:** Keep default (21 days, +2 points).

---

## 5. Things They Want That Don't Exist Yet

- **Jurisdiction-filtered playbooks:** Rui's explicit ask — certain playbooks legal in the US may not be applicable or legal in other jurisdictions. A compliance flag on playbooks (e.g. `us_only: true`) that suppresses them for international accounts would prevent CSMs from accidentally running inappropriate plays. Proposed shape: not a trigger — a playbook metadata field + account-level jurisdiction tag. Any trigger that recommends a US-only playbook should not surface it for this org.

- **Region/country tag on accounts:** A field that marks the account's jurisdiction, used to filter playbooks and potentially adjust cadence expectations. Not a trigger — a required account attribute for this org.

- **Language/localization flag:** For accounts in non-English markets, a signal that key customer-facing materials (email templates, success plan docs) haven't been localized could be useful. Proposed shape: `custom trigger -> manual category, weight 1` (informational, surfaces on worklist for CSM to address).

- **International procurement cycle awareness:** Some markets (EU government, for example) have very rigid annual budget cycles. A custom trigger that accounts for country-specific renewal timing rather than just contract end date would reduce missed renewal prep. Proposed shape: similar to 911 budget cycle request — custom field on account feeds into `renewal_stage_behind` threshold.

- **Data residency note:** Depending on jurisdiction (GDPR, etc.), certain data fields pulled from Salesforce may have residency or consent constraints. This is worth flagging as a compliance note for the field registry — not a trigger, but a metadata concern for which Salesforce objects are synced for international accounts.

---

## 6. Example Chat Phrases for This Org

- "Some of our playbooks only apply in the US — we need to filter those out"
- "We need to tag accounts by country so the wrong plays don't surface"
- "Renewal timelines in our markets are longer — extend the prep window"
- "Onboarding quality is our biggest risk — weight those triggers higher"
- "We need to know when customer-facing content hasn't been localized"
- "Some data fields may have GDPR constraints — flag those for our org"
