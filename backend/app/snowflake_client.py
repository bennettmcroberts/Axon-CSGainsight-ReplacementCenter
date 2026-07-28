"""Live data path backed by the MART_CUSTOMER_SUCCESS_PROD Snowflake mart.

Like mock_engine.py, this does not parse SOQL generically - it pattern-matches
the same known query shapes the frontend sends (see mock_engine.py's module
docstring) and answers the ones this mart actually has data for: renewals
(with segment), won-deal/LTV aggregates, blocked-case counts, and per-account
deal history.

Unlike mock_engine.run_mock_query, run_snowflake_query returns None (not [])
for any shape it doesn't recognize, so hybrid_engine.py can tell "not my
shape, route elsewhere" apart from "my shape, but genuinely zero rows".

Needs SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD, SNOWFLAKE_WAREHOUSE,
SNOWFLAKE_ROLE and (optionally) SNOWFLAKE_DATABASE in backend/.env - see
config.py for the exact settings and .env for the template.

Account-ID note: the renewals query (shape 1) is the only one that seeds the
frontend's account universe, and it returns SALESFORCE_ROOT_ACCOUNT_ID as
AccountId. Every other shape below receives that same root ID back in its
IN-list/single-account filter, so no separate leaf->root translation via
ACCOUNT_ROOT_MAPS is needed here.
"""
from __future__ import annotations

from functools import lru_cache

from .config import settings
from .soql_helpers import extract_quoted, single_account_id

MART = "MART_CUSTOMER_SUCCESS_PROD"


class SnowflakeUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client():
    try:
        import snowflake.connector
    except ImportError as e:  # pragma: no cover
        raise SnowflakeUnavailable("snowflake-connector-python is not installed") from e

    if not settings.snowflake_configured:
        raise SnowflakeUnavailable(
            "Snowflake credentials are not configured. Fill in SNOWFLAKE_ACCOUNT, "
            "SNOWFLAKE_USER, SNOWFLAKE_PASSWORD and SNOWFLAKE_WAREHOUSE in "
            "backend/.env, then set DATA_MODE=hybrid."
        )
    try:
        return snowflake.connector.connect(
            account=settings.sfk_account,
            user=settings.sfk_user,
            password=settings.sfk_password,
            warehouse=settings.sfk_warehouse,
            role=settings.sfk_role,
            database=settings.sfk_database,
        )
    except Exception as e:  # noqa: BLE001
        raise SnowflakeUnavailable(f"Snowflake connection failed: {e}") from e


def _rows(query: str, params: tuple = ()) -> list[dict]:
    conn = _client()
    cur = conn.cursor()
    try:
        cur.execute(query, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    finally:
        cur.close()


def _id_list_sql(ids: set[str]) -> str:
    # extract_quoted only ever returns regex-constrained [A-Za-z0-9_]+ tokens, so
    # inlining them as quoted literals here carries no injection risk.
    return ",".join(f"'{i}'" for i in ids)


def run_snowflake_query(query: str) -> list[dict] | None:
    q = query.strip()
    qlow = q.lower()
    qflat = qlow.replace(" ", "")

    if "from opportunity" in qlow and "type='renewal'" in qflat and "growthtype" not in qlow:
        return _q_renewals()
    if (
        "from opportunity" in qlow
        and "iswon=true" in qflat
        and "group by accountid" in qlow
        and "growthtype" not in qlow
    ):
        return _q_deal_agg(q)
    if "from case" in qlow and "status='blocked'" in qflat:
        return _q_case_blocked(q)
    if "from opportunity" in qlow and "iswon=true" in qflat and "group by accountid" not in qlow:
        # Single-account deal-history lookup (mock's _q_account_deals shape).
        acc_id = single_account_id(q)
        if acc_id is not None:
            return _q_account_deals(acc_id)
    return None


def _q_renewals() -> list[dict]:
    rows = _rows(
        f"""
        SELECT o.SALESFORCE_OPPORTUNITY_ID AS ID, o.OPPORTUNITY_NAME AS NAME,
               o.AMOUNT_LOCAL AS AMOUNT, o.CLOSE_DATE AS CLOSE_DATE, o.STAGE_NAME AS STAGE_NAME,
               o.SALESFORCE_ROOT_ACCOUNT_ID AS ACCOUNT_ID, l.ROOT_ACCOUNT_NAME AS ACCT_NAME,
               l.MARKET_SEGMENT AS SEGMENT, l.SALESFORCE_ACCOUNT_EXECUTIVE_USER_ID AS OWNER_ID,
               l.ACCOUNT_EXECUTIVE_NAME AS OWNER_NAME
        FROM {MART}.CORE.OPPORTUNITY_LOGOS o
        JOIN {MART}.CORE.LOGO_DIMENSIONS l ON l.SALESFORCE_ROOT_ACCOUNT_ID = o.SALESFORCE_ROOT_ACCOUNT_ID
        WHERE o.OPPORTUNITY_TYPE ILIKE '%renewal%' AND o.IS_CLOSED = FALSE
          AND o.CLOSE_DATE BETWEEN DATEADD(month, -1, CURRENT_DATE()) AND DATEADD(month, 18, CURRENT_DATE())
        ORDER BY o.AMOUNT_LOCAL DESC
        LIMIT 300
        """
    )
    out = []
    for r in rows:
        out.append({
            "Id": r["ID"],
            "Name": r["NAME"],
            "Amount": float(r["AMOUNT"]) if r["AMOUNT"] is not None else None,
            "CloseDate": str(r["CLOSE_DATE"]) if r["CLOSE_DATE"] else None,
            "StageName": r["STAGE_NAME"],
            "AccountId": r["ACCOUNT_ID"],
            "Account": {
                "Name": r["ACCT_NAME"],
                # Not modeled in this mart.
                "BillingState": None,
                "LastActivityDate": None,
                "Segment": r["SEGMENT"],
            },
            "OwnerId": r["OWNER_ID"],
            # The mart's closest analog to Opportunity Owner is the account executive,
            # not the CSM - flagged in NOTES.md as an assumption to confirm.
            "Owner": {"Name": r["OWNER_NAME"], "Title": "Account Executive"},
        })
    return out


def _q_deal_agg(q: str) -> list[dict]:
    ids = set(extract_quoted(q))
    if not ids:
        return []
    rows = _rows(
        f"""
        SELECT SALESFORCE_ROOT_ACCOUNT_ID AS ACCOUNT_ID, COUNT(*) AS C, SUM(AMOUNT_LOCAL) AS S,
               MIN(CLOSE_DATE) AS MN, MAX(CLOSE_DATE) AS MX
        FROM {MART}.CORE.OPPORTUNITY_LOGOS
        WHERE IS_WON = TRUE AND SALESFORCE_ROOT_ACCOUNT_ID IN ({_id_list_sql(ids)})
        GROUP BY SALESFORCE_ROOT_ACCOUNT_ID
        """
    )
    return [
        {
            "AccountId": r["ACCOUNT_ID"],
            "c": r["C"],
            "s": float(r["S"]) if r["S"] is not None else 0.0,
            "mn": str(r["MN"]) if r["MN"] else None,
            "mx": str(r["MX"]) if r["MX"] else None,
        }
        for r in rows
    ]


def _q_case_blocked(q: str) -> list[dict]:
    ids = set(extract_quoted(q))
    if not ids:
        return []
    rows = _rows(
        f"""
        SELECT SALESFORCE_ROOT_ACCOUNT_ID AS ACCOUNT_ID, COUNT(*) AS C
        FROM {MART}.CORE.CASE_LOGOS
        WHERE STATUS = 'Blocked' AND SALESFORCE_ROOT_ACCOUNT_ID IN ({_id_list_sql(ids)})
        GROUP BY SALESFORCE_ROOT_ACCOUNT_ID
        """
    )
    return [{"AccountId": r["ACCOUNT_ID"], "c": r["C"]} for r in rows]


def _q_account_deals(acc_id: str) -> list[dict]:
    rows = _rows(
        f"""
        SELECT OPPORTUNITY_NAME AS NAME, AMOUNT_LOCAL AS AMOUNT, CLOSE_DATE AS CLOSE_DATE,
               STAGE_NAME AS STAGE_NAME
        FROM {MART}.CORE.OPPORTUNITY_LOGOS
        WHERE IS_WON = TRUE AND SALESFORCE_ROOT_ACCOUNT_ID = %s
        ORDER BY CLOSE_DATE DESC
        LIMIT 8
        """,
        (acc_id,),
    )
    return [
        {
            "Name": r["NAME"],
            "Amount": float(r["AMOUNT"]) if r["AMOUNT"] is not None else None,
            "CloseDate": str(r["CLOSE_DATE"]) if r["CLOSE_DATE"] else None,
            "StageName": r["STAGE_NAME"],
            # Not modeled in this mart (no growth-type taxonomy here).
            "GrowthType": None,
        }
        for r in rows
    ]
