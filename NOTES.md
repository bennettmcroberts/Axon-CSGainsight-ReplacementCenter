# Design notes: guidance from a CS-leadership interview

These notes capture the parts of a conversation with an Axon enterprise Customer
Success leader (referred to below as "the CS lead") that shaped features in this
app. He has run CS orgs since customer success became a discipline (careerbuilder.com,
Fleetmatics/Verizon, KeepTruckin/Motive, now Axon's enterprise/"giant killing" CS team),
has deployed and abandoned Gainsight, and now builds his own internal tooling with
Cursor + an internal deploy pipeline. Quotes are paraphrased from a call transcript
and attributed to him throughout; anything in *italics* is the interviewer or general
context, not a direct quote.

## Why not Gainsight

- *"I've deployed Gainsight in the past, I hated it... it took 3 tries just to get the
  thing up and running, and even then, they weren't doing what I was asking."*
- *"Gainsight is code heavy... you've got to put it into a queue, they've got to make
  changes."* At a large company, CS customizations queue behind sales work and
  routinely lose that priority fight — "that doesn't bother me one bit, it's
  understanding the hierarchy of life," but it means CS tooling stagnates.
- CS is *"a jack of all trades, a master of none"* — service, sales, support and
  account management all at once, plus covering for operational and product gaps.
  Off-the-shelf tools built for one discipline "are not fit for purpose" for that
  blend.
- His conclusion, thanks to AI-assisted coding: build your own thin app on top of
  Salesforce/Snowflake rather than paying for an overlay that's *"just an amalgamation
  of sales automation and marketing automation."* Salesforce is treated more like a
  BI/analytics platform than a workflow tool; the workflow layer is something CS
  should own and iterate on directly.
- Biggest risk in doing this ourselves: *"putting pedestrian tasks in front of the
  team again... if it's just putting the same tasks in front of them, they already
  have those in Salesforce and in Gainsight — you did them no good."* The tool has to
  be built around **how the team actually operates**, not just digitize what already
  exists. This app tries to earn its place by adding new leverage (cadence tracking,
  blocked/aging triage, a resource library, a customer-insight log) rather than just
  re-skinning existing Salesforce views.

## Skepticism of health scores

> *"By the way, I'm not a fan of health scores... health scores are not what they're
> cracked up to be, for a whole lot of reasons."*

Reflected in this app: **Health Model** is kept (it's genuinely useful for the
renewal-triage and escalation logic under the hood), but it is explicitly *not* the
headline metric anymore. Home and Command Center now lead with engagement, growth and
customer insights, with a callout on the Health Model tab quoting this concern
directly.

## The 4 metrics his team is actually run on

> *"My team runs off of four main metrics today... I pay them on, and rate their
> performance around [these]."*

1. **Customer insights** — capturing and distilling what the team is learning about
   customers, which matters especially because *"we're building a net-new motion...
   we are creating a market that doesn't exist at the moment."* → the **Customer
   Insights** log on each Account 360 page, rolled up per-CSM on the **CSM Scorecard**.
2. **Engagement rate** — a proactive, outbound motion. Only certain activity types
   count, and the required cadence differs by segment (*"SMB, mid-market, enterprise,
   strategic... it's one of the ways I guarantee to the business good stewardship"*).
   → the **Engagement** tab tracks accounts against a per-segment cadence requirement
   and flags who's falling out of cadence.
3. **Growth**, split into (his words, paraphrased):
   - *Organic* — renewals and rewrites. ("Should not technically be called growth,
     since renewing isn't growth — but it lives in this bucket anyway.")
   - *Expansion* — net-new product attach: "they didn't have [it] before... there's a
     sales motion there, you actually have to go present value, maybe run a pilot."
   - *Transactional* — buying more of what they already have ("I hired more people, I
     added a location, I'll just buy more of the same... it's a transaction, not a
     true sales process"). Still valuable — *"it's where most of your growth comes
     from over time"* — just a different motion than expansion.
   → modeled directly in the mock data (`GrowthType` per closed-won deal) and surfaced
   on Home, Command Center, and the CSM Scorecard as three separate numbers, not one
   lump "growth."
4. *(A fourth metric — a "today view" cockpit of daily priorities — is really the
   umbrella above all of these; see "Today view" below.)*

Also mentioned: **targets** per metric that roll down to individual CSMs — *"when I
can put a target in here, they can actually track to their targets... this filters
down to different CSMs, which Gainsight doesn't really help you do."* → editable
targets on the CSM Scorecard tab (engagement %, growth $, insights count), with
progress bars per CSM.

## "Today view" — what a CSM should see first

> *"This is like a cockpit for them... they can decide what they're looking at."*

Priorities he described, roughly in the order he gave them:

- **Out-of-cadence logos** — accounts about to fall (or that have fallen) out of the
  required outreach cadence. *"If I'm Jake, I need to make outreach to [account]
  toot suite, because now they're falling out of cadence."* → **Engagement** tab.
- **Blocked vs. aging cases** — *"you can't look at everything all at once... cases,
  you either want to know what's blocked, so 'oh shit, it's not happening,' or aging,
  it's been around too long. These are the two things you need to jump on and
  escalate — they either block growth or, even worse, [the customer] sends an email to
  [an executive]."* → dedicated **Case Watch** tab, plus a Blocked/Aging tile on
  Account 360, distinct from the general open-case count.
- **Renewals** and **TAP refresh** (hardware replacement motions) — already covered by
  the existing Renewals tab and CTA types.
- **Book of business** view, filtered to a given CSM — already covered by "View as
  CSM" and the Org Drill-down.
- Account page: product data (he called this a struggle — *"I don't have as good of
  access to product data as [the other side of] the business"*), an AI summary of
  recent activity/pipeline, and recent activity history — already covered by the
  existing Account 360 (Products purchased, Communications).

## Customer guides / SOPs / internal resources

> *"We're starting to build out use cases... how do our customers actually use the
> product... it's a link, and they can get to it. One of the problems with a lot of
> enablement and marketing materials is it gets lost — it just becomes a link somebody
> can't find. I can update this link, anybody can update these links in real time, and
> it's inside their execution tool."*

He described building this out for onboarding SOPs, RMA resources, and
prescriptive-usage guides. → **Resource Library** tab: a small, editable, topic-tagged
link library, plus a read-only "Resources & guides" card on every Account 360 page so
it's visible in context.

## Success plans

He keeps a lightweight (not-yet-digitized) success plan per account — goals, account
context, links out to topic resources ("I need to know about RMAs? Here's all our
resources on RMAs"). This app's existing **Success Plans** tab already covers this;
the new Resource Library card on Account 360 is the "linked resources" half of what he
described.

## Data architecture guidance

> *"We're sourcing it from, ideally, Salesforce... the goal here is not to not use
> Salesforce, it's to build a workflow that is around my team so they operate [inside
> it]."*

- **Salesforce stays the system of record.** His team's tool is a workflow layer *in
  front of* Salesforce, not a replacement for it — every disposition (notes, field
  edits, task creation) still funnels back into Salesforce so the rest of the business
  can source from it. This app follows the same principle: nothing here should become
  a second, disconnected source of truth. Local `localStorage` state (plans, CTAs,
  escalation notes, insights, resources, targets) is meant to be a placeholder for a
  real Salesforce object once fields are available, not a permanent home for the data.
- **Product data is read-only.** *"That comes out of the product team... we never want
  to write to the product, just read from it."*
- **NPS/CSAT sourcing**: *"I'd get Nova Sales Snowflake access — you can get pretty
  much everything you need out of there... there is an NPS dashboard in Salesforce...
  we don't have a CSAT process [for CS], support may, but customer success does not."*
  Recommended combo: an MCP into Snowflake (Nova Sales) plus an MCP into Salesforce.
  Practical implication for this app: **CSAT will likely stay a placeholder** (as it
  already is) until/unless a real survey pipeline exists for CS specifically; **NPS**
  is realistically sourceable from Salesforce or Snowflake today and would be the
  better near-term target to wire in for real.
- **His update pipeline is manual**: *"I have to use Cursor to run an update, and then
  redeploy on the HIP... we can't automate that yet."* Data goes stale until the next
  deploy (in his case, ~once a day). Good context if this app is ever pushed through a
  similar internal deploy pipeline instead of running a live backend continuously.

## Update: consolidated stakeholder findings (Leana, Beatrice, Derek Frier, Mark & Taylor, Rui)

A second, much broader round of research came in after the original CS-lead
interview above (that source is referred to here as **Derek Frier** — the
Enterprise team lead who deployed and abandoned Gainsight; everything in the
sections above was effectively "Derek's version" of this app). This round adds
four more voices: **Leana** (CS leader, actual sponsor of the Gainsight-replacement
effort) & **Beatrice** (her Gainsight admin), **Mark & Taylor** (CSM/TAM power
users who build their own tools), and **Rui** (a CS leader skeptical of building
at all, who recommends buying Totango instead).

Cross-referencing all five sources surfaced real conflicts that this app doesn't
try to resolve unilaterally:

- **Health scoring** — Leana wants one; Derek is explicitly against it (see
  "Skepticism of health scores" above). This app already splits the difference —
  kept, but de-emphasized and tunable — which happens to match a "make it
  optional" resolution, but that was a byproduct of Derek's original guidance,
  not a deliberate compromise between the two.
- **One shared tool vs. team-specific tools** — Derek/Mark/Taylor lean toward
  letting every team build to its own motion; Leana's ask is a unified portfolio
  view across all segments (Pooled/Inside, SMB/Direct, Field/Mid-market, Majors,
  Vertical Markets — segments with wildly different scale, e.g. 9 CSMs covering
  18,000 pooled accounts vs. 12-13 CSMs covering 25-30 Majors accounts each).
  **Left unresolved on purpose** — flagged for Leana/Derek/Rui to decide before
  this app's targets/thresholds are forked or made segment-configurable.
- **Build vs. buy (Rui recommends Totango)** and **model on current vs. target
  future CS workflow (Rui's warning)** — both are leadership/strategy calls
  outside this app's scope. Noted here so nobody mistakes "we kept building" as
  an implicit answer to either question.

### What got added from this round

- **NPS** — Leana's framing: a real biannual survey (10% of CSM comp) that
  already lands in a Salesforce report, unlike CSAT (which stays a genuine
  placeholder — no CS-specific CSAT process exists per Derek). Modeled as a
  sourced field, not a manual override: `nps` + `npsDate` per account, an
  aggregate promoter-minus-detractor rollup (`npsRollup`), surfaced on Home,
  Overview, the CSM Scorecard, and Account 360.
- **"Who's on this account" team roster** — Leana's cross-team blindness
  complaint plus Mark's "Axon Team" section, which he called "probably the
  biggest issue with customers" (they don't know who to contact). Tracks both
  the Axon-side team (CSM, TAM, engagement specialist, fleet installer, etc.)
  and the customer-side contacts, per account, on Account 360. Stored in
  `localStorage` for now — no standard Salesforce object backs this yet.
- **Manager coaching drill-down on stale work** — Leana's example: a leader
  should be able to see exactly where a CSM is stuck ("7 tasks 6 months
  overdue") instead of digging through every account. Added an "Overdue items"
  column on the CSM Scorecard (open CTAs + Success Plan milestones past due,
  worst first) that opens a drill-down sheet per CSM.

### What was deliberately not built from this round, and why

- **APAP (adoption points) scoring** — nobody has a real data source for this
  yet; inventing one would violate the #1 cross-source finding from this round
  (data shown must be accurate, not just present — Leana's live demo showed
  wrong data, Mark independently called Gainsight's data unreliable).
- **TAP refresh tracking, escalation reason/product tagging, structured Success
  Plan discovery fields, playbook-per-task links, configurable auto-CTA
  thresholds** — real, corroborated asks, intentionally deferred rather than
  built speculatively; see the evaluation this app's author walked through with
  the requester for the full prioritized list.
- **Customer-facing pages, real write-back to Salesforce, actual bulk email
  sending, a full rules engine / per-CSM alerts** — each hits either an
  InfoSec wall (data must stay on Axon servers), needs a scoped integration
  project of its own (Salesforce write API + custom fields + permissions), or
  was explicitly called out as v2 in the source research.

## Custom fields this app assumes for live Salesforce parity

The mock engine invents a few fields that don't exist in a stock Salesforce org. If
you flip `DATA_MODE=salesforce`, these queries will return nothing until equivalent
fields/logic exist on the real org (see `README.md` for where each query is built):

| Mock field | Used for | Real-org equivalent needed |
|---|---|---|
| `Account.Segment` (`Segment__c`) | Engagement cadence tier, CSM Scorecard | An existing tiering field (e.g. `Account.AccountType__c`), or a new picklist |
| `Case.Status='Blocked'` | Case Watch — blocked cases | An existing case status value, or a new checkbox `IsBlocked__c` |
| `Case.IsAging__c` | Case Watch — aging cases | Derive from `Case.CreatedDate` age instead of a stored flag — this app models it as a boolean for simplicity |
| `Opportunity.GrowthType__c` | Growth mix (Renewal/Expansion/Transactional), CSM Scorecard growth columns | No Salesforce standard equivalent — would need a new picklist field on won Opportunities, or a derivation rule (e.g. compare product families across an account's deal history) |
| `Account.NPS_Score__c` / `SurveyDate__c` | NPS on Home, Overview, CSM Scorecard, Account 360 | Per Leana: this is real today, sourced from the biannual NPS survey's existing Salesforce report (or Nova Sales Snowflake) — needs the report's underlying object/fields identified and queried instead of this placeholder shape |

Everything else (renewals, org hierarchy, cases, deals, line items, tasks/events)
already maps onto stock Salesforce objects/fields, as covered in the main README.
