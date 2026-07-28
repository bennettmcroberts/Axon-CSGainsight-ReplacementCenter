# Org Config Reference — current app configuration surface

Purpose: this document is the complete, accurate catalog of every currently
configurable parameter in the Axon CS Command Center app (real values, not
invented), plus the proposed JSON schema for a future per-org config file.
Feed this into a separate session along with what each of your 5 CSM orgs
wants, and get back 5 org-specific reference docs shaped to match the schema
at the bottom. Bring those back and the actual "chat in Configure Org Data"
feature gets built against them.

## The one architectural rule everything below has to respect

The pipeline is fixed and does not change per org:

```
a trigger fires (some condition on some account)
  -> routes to exactly one category: an Escalation, or one of the CTA
     categories (renewal / usage / case_watch / cadence / manual)
  -> that category has a fixed step SHAPE (escalation's 6-step checklist,
     or a CTA's standard 3-step flow, or a CTA's branching 4-step flow)
  -> the same engagement/email/timeline/contact-matrix machinery runs either way
```

Org customization only ever changes: whether a trigger is enabled, its
label/wording, its weight, its threshold, and *which existing category* it
routes to. It never invents a new step shape, a new page, or a new piece of
machinery. A brand-new trigger an org invents just needs to declare itself
against this same shape (category + weight + threshold) and the existing
code handles it exactly like any of the current ones - this is already true
today (see `case_volume_spike`/`no_exec_sponsor`/`qbr_overdue`, all added
this way with zero new UI code).

## 1. Risk triggers (the Accounts & Risk engine)

16 trigger types exist today. For each: its label, which category it routes
to, and its weight (how many points it adds to an account's risk score
while open).

| Trigger key | Label | Routes to | Weight |
|---|---|---|---|
| case_blocked | Case blocked past SLA | Escalation | 3 |
| nps_csat_drop | NPS/CSAT drop | Escalation | 3 |
| negative_sentiment | Negative customer sentiment | Escalation | 3 |
| case_aging | Case aging | Escalation | 2 |
| case_volume_spike | Open case volume spike | Escalation | 2 |
| no_exec_sponsor | No executive sponsor on file | Escalation | 2 |
| renewal_stage_behind | Renewal stuck in early stage | Renewal CTA | 2 |
| onboarding_stall | Onboarding milestone overdue | Usage & Adoption CTA | 2 |
| onboarding_no_plan | New logo missing a success plan | Usage & Adoption CTA | 2 |
| usage_drop | Usage below adoption target | Usage & Adoption CTA | 1 |
| tap_refresh_due | TAP (hardware) refresh due | Case Watch CTA | 1 |
| growth_mix_stalled | No cross-sell/upsell ever | Renewal CTA | 1 |
| renewal_prep_stale | No renewal-prep activity | Renewal CTA | 1 |
| qbr_overdue | QBR overdue | Cadence CTA | 1 |
| cadence_gap | Overdue for routine check-in | Cadence CTA | (uses aging only, no base weight set) |
| escalation_opened | Escalation opened (manual) | Escalation | scales by severity - see below |

Escalation severity (used only for `escalation_opened`, and for `autoSeverity()`
elsewhere): Low=1, Medium=2, High=4, Critical=6.

**Score -> stage thresholds**: score >= 5 = "Active Risk" (Escalated column);
score >= 3 = "Elevated Risk" (At-risk column); score >= 1 = "Early Signal"
(Watch column); 0 = Stable.

**Aging**: every 21 days a trigger sits open and unaddressed, it gains +2
more points on top of its base weight (rewards fast resolution, penalizes
letting things sit).

**Case SLA by segment** (days before an open case counts as "blocked"):
Enterprise=5, Mid-Market=10, SMB=15.

**Renewal-prep windows**: a renewal within 60 days with no account activity
logged in the last 30 days fires `renewal_prep_stale`.

**Case-volume-spike threshold**: 6+ open cases on one account.

**QBR-overdue threshold**: 90+ days since the last QBR (demo-modeled only -
no live QBR data source confirmed yet, see below).

**Cadence expectations by segment** (days between routine touches before
`cadence_gap` fires): Strategic=30, Enterprise=45, Mid-Market=60, SMB=90.

## 2. Health score (separate from risk stage - see the note in the last
   session's build about these being independent formulas)

Health is 0-100, computed as a penalty subtracted from 100:

| Factor | Penalty weight |
|---|---|
| Per open case | 2 (capped at 26 total) |
| Per high/urgent case | 9 (capped at 30 total) |
| Renewal within 90 days | 22 |
| Renewal within 91-180 days | 10 |
| Near renewal (<=120d) still in an early sales stage | 12 |
| No engagement logged, or >180 days since last touch | 16 |
| 91-180 days since last touch | 8 (half of the above) |

**Tier cutoffs**: health >= 75 = Healthy, >= 50 = Watch, below 50 = At risk.

## 3. CTA categories and their step shapes

| Category | Label | Step shape |
|---|---|---|
| escalation | Escalation | Fixed 6-step checklist: Acknowledge -> Identify root cause -> Loop in product/eng -> Provide resolution -> Confirm satisfaction -> Close out |
| renewal | Renewal | Branching: Email sent -> [Loop in sales] + [Meeting scheduled] in parallel -> Problem resolved |
| case_watch | Case Watch | Branching (same shape as renewal) |
| usage | Usage & Adoption | Standard: Email sent -> Meeting scheduled -> Problem resolved |
| cadence | Cadence check-in | Standard (same shape as usage) |
| manual | Manual | Standard (default for anything not explicitly routed) |

Branch categories auto-CC `sales@axon.com` on the first email (sales has a
real stake in renewal/case_watch triggers specifically).

## 4. Email templates in play

Customer-facing: `cust_welcome` (new logo), `cust_renewal`, `cust_product`
(adoption/usage), `cust_expansion` (cross-sell), `cust_tap` (hardware
refresh), `cust_save` (risk/escalation check-in), `cust_checkin` (cadence),
`cust_onboarding_nudge`. Each trigger's recommended action maps to exactly
one of these - e.g. `escalate_to_support_lead` -> `cust_save`,
`schedule_tap_refresh` -> `cust_tap`.

## 5. Predictive Insights (the 3rd, no-risk-signal prong)

Always proposes a 6-step relationship-building timeline (Week 1/3/5/7/9/12),
each step optionally tagged with one of the 3 "soft touch" email templates
(`cust_checkin`, `cust_product`, `cust_expansion`) or `null` for an internal
step. If the account currently has a live risk trigger, a 7th step ("Address
the active risk signal") is always prepended first and always routes into
the real Escalations/CTA record - this one step is never left to org
customization, since it's a data/routing fact, not a preference.

## 6. Usage/Adoption thresholds

Adopting-customer cutoff: 60% (`adoptingPct`). At-risk cutoff: 35% (`atRiskPct`).

## 7. What's demo-modeled only (not a live Salesforce query yet)

Contract (notice period), Contact (Executive Sponsor persona), Event (QBR
date), Account.Industry/EmployeeCount. These currently default to
"no signal" for every real account and only have values on a couple of
seeded demo accounts. An org's config could still turn these on/off and set
their weights now - the live-query wiring is a separate, later step.

---

## Proposed JSON schema for a per-org config file

This is what "the API reads another context file and changes this JSON" would
actually produce/modify. The frontend would read this instead of the current
hardcoded constants (`DEFAULT_RISK_WEIGHTS`, `CTA_CATEGORY_BY_TRIGGER`, etc.)
- same shape as those objects already have today, just parameterized:

```json
{
  "orgId": "org_a",
  "orgName": "Example CSM Org",
  "updatedAt": "2026-08-01T00:00:00Z",
  "updatedFromRequest": "one-line summary of the chat request that produced this version",

  "riskTriggers": {
    "case_blocked": { "enabled": true, "label": "Case blocked past SLA", "category": "escalation", "weight": 3 },
    "nps_csat_drop": { "enabled": true, "label": "NPS/CSAT drop", "category": "escalation", "weight": 3 },
    "qbr_overdue": { "enabled": false, "label": "QBR overdue", "category": "cadence", "weight": 1 }
  },
  "riskThresholds": { "elevated": 3, "active": 5, "agingDays": 21, "agingBonus": 2 },
  "caseSlaBySegment": { "Enterprise": 5, "Mid-Market": 10, "SMB": 15 },
  "cadenceBySegment": { "Strategic": 30, "Enterprise": 45, "Mid-Market": 60, "SMB": 90 },

  "healthWeights": { "openCase": 2, "highSev": 9, "proxNear": 22, "proxMid": 10, "stageRisk": 12, "engage": 16 },
  "healthTierCutoffs": { "healthy": 75, "watch": 50 },

  "adoption": { "adoptingPct": 60, "atRiskPct": 35 },

  "customTriggers": [
    {
      "key": "radio_refresh_due",
      "label": "Radio hardware refresh due",
      "category": "case_watch",
      "weight": 1,
      "sourceObject": "OpportunityLineItem",
      "sourceField": "Family__c + CloseDate",
      "note": "Same shape as tap_refresh_due, just a different hardware family/timing rule"
    }
  ]
}
```

Every key in `riskTriggers` maps 1:1 to an existing engine trigger; `category`
must be one of the 6 existing categories above - never a new one. Anything
under `customTriggers` follows the exact same required shape (key/label/
category/weight) as a normal built-in trigger, which is what lets a
never-planned-for input work "as expected" without new code, exactly like
you described.

---

## How to structure each of the 5 org reference docs

For each CSM org, write a doc (same convention as the Test10 account files)
covering:

1. **Org name/identity** - just a label.
2. **What's different about their book** - segment mix, typical account
   size, anything that explains WHY they'd want different weights/timing
   (e.g. "mostly SMB, high volume, low touch" vs "a handful of large
   Enterprise accounts, white-glove").
3. **Trigger preferences** - which of the 16 above they'd turn off, which
   they'd weight higher/lower, and why in one sentence each.
4. **Timing preferences** - SLA days, cadence days, aging window - only the
   ones that differ from the defaults above.
5. **Anything they want that doesn't exist yet** - described in plain
   English (e.g. "we want to know when a customer hasn't opened our product
   in 30 days") - the chat feature's job will be to map this to the
   `customTriggers` shape (pick a category, a weight, invent a key).
6. **A few example phrases they might actually type into the chat** - this
   is the "keyword-matching" hook for later (e.g. "turn down case blocked
   sensitivity", "we don't care about QBRs", "add a trigger for X") - having
   3-5 realistic example requests per org makes the keyword-matching
   meaningfully testable once built.

Keep each doc to roughly the same length as the Test10 account files - rich
enough to be useful, not exhaustive.
