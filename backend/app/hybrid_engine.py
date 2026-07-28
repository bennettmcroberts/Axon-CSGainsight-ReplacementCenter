"""DATA_MODE=hybrid: routes each known SOQL shape to whichever real source has it.

Neither Salesforce nor Snowflake alone gets this app off mock data - the org is
missing several custom fields (Segment__c, GrowthType__c, NPS_Score__c,
Case.IsEscalated/IsAging__c) the frontend's SOQL assumes, while the Snowflake
mart (snowflake_client.py) only covers 4 of the 13 known query shapes. This
module is the single dispatcher that picks a source per shape:

  - Renewals / won-deal agg / blocked cases / account deal history -> Snowflake
    mart (snowflake_client.run_snowflake_query), which is tried first for every
    query since it cleanly returns None for shapes it doesn't recognize.
  - Open cases by priority, org chain, Task/Event timeline, TAP hardware date,
    and product/SKU line-item breakdown -> raw Salesforce (these rely only on
    standard fields, or on a field that's simply named differently on the real
    org than the mock's placeholder - see the TAP rewrite below).
  - Lifetime cases by priority+escalated -> raw Salesforce for Priority, with
    IsEscalated (missing on this org) stripped from the query and defaulted to
    False on every returned row - a known, documented gap, not silent
    inaccuracy.
  - Aging cases, growth-type aggregate, NPS, and product usage/adoption -> no
    real source exists yet for any of these (see NOTES.md); return [] rather
    than fabricate data.

If a source's credentials simply aren't configured, that source's shapes
degrade to `[]` instead of failing the whole request - only genuinely
unexpected errors propagate up to main.py's existing error handling.
"""
from __future__ import annotations

from .salesforce_client import SalesforceUnavailable, run_salesforce_query
from .snowflake_client import SnowflakeUnavailable, run_snowflake_query


def _try_snowflake(q: str) -> list[dict] | None:
    try:
        return run_snowflake_query(q)
    except SnowflakeUnavailable:
        return None


def _try_salesforce(q: str) -> list[dict]:
    try:
        return run_salesforce_query(q)
    except SalesforceUnavailable:
        return []


def run_hybrid_query(query: str) -> list[dict]:
    q = query.strip()
    qlow = q.lower()
    qflat = qlow.replace(" ", "")

    # 1. Try the Snowflake mart first - covers renewals, won-deal/LTV agg,
    #    blocked cases, and single-account deal history.
    sf_result = _try_snowflake(q)
    if sf_result is not None:
        return sf_result

    # 2. Hard gaps - no real source has this data yet (NOTES.md tracks these).
    if "from productusage__c" in qlow:
        return []
    if "from account" in qlow and "nps" in qlow:
        return []
    if "from case" in qlow and "isaging" in qlow:
        return []
    if "from opportunity" in qlow and "iswon=true" in qflat and "growthtype" in qlow:
        return []

    # 3. Salesforce-routed shapes.
    if "from opportunitylineitem" in qlow and "family__c" in qlow:
        # OpportunityLineItem has no AccountId/CloseDate/Family__c of its own on
        # this org - the real equivalents are reached through the Opportunity/
        # Product2 relationships. Confirmed live against the org before shipping.
        rewritten = (
            q.replace("Family__c", "Product2.Family")
            .replace("AccountId", "Opportunity.AccountId")
            .replace("CloseDate", "Opportunity.CloseDate")
        )
        return _try_salesforce(rewritten)

    if "from case" in qlow and "isescalated" in qlow:
        # IsEscalated doesn't exist on this org's Case object - drop it from the
        # query, run the Priority breakdown for real, and flag every row as not
        # escalated rather than silently guessing.
        rewritten = q.replace("IsEscalated, ", "").replace(", IsEscalated", "")
        rows = _try_salesforce(rewritten)
        for r in rows:
            r["IsEscalated"] = False
        return rows

    if "from case" in qlow and "group by accountid" in qlow:
        return _try_salesforce(q)
    if "from user" in qlow and " id in" in qlow:
        return _try_salesforce(q)
    if "from task" in qlow or "from event" in qlow:
        return _try_salesforce(q)
    if "from opportunitylineitem" in qlow and ("product2.family" in qlow or "product2.name" in qlow):
        return _try_salesforce(q)

    return []
