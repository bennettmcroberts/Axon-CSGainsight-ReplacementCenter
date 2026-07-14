"""Thin wrapper around simple-salesforce for the live Salesforce data path.

Uses the SOAP username/password/security-token login flow, which does not
require a Connected App - just the credentials in backend/.env:

    SF_USERNAME=you@axon.com
    SF_PASSWORD=your-password
    SF_SECURITY_TOKEN=your-security-token
    SF_DOMAIN=login          # or "test" for a sandbox, or your My Domain prefix

If your org has the SOAP login API disabled, this will raise on first use -
see README.md for the OAuth Connected App fallback.
"""
from __future__ import annotations

from functools import lru_cache

from .config import settings


class SalesforceUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client():
    try:
        from simple_salesforce import Salesforce
    except ImportError as e:  # pragma: no cover
        raise SalesforceUnavailable("simple-salesforce is not installed") from e

    if not settings.salesforce_configured:
        raise SalesforceUnavailable(
            "Salesforce credentials are not configured. Fill in SF_USERNAME, SF_PASSWORD "
            "and SF_SECURITY_TOKEN in backend/.env, then set DATA_MODE=salesforce."
        )
    try:
        return Salesforce(
            username=settings.sf_username,
            password=settings.sf_password,
            security_token=settings.sf_security_token,
            domain=settings.sf_domain,
        )
    except Exception as e:  # noqa: BLE001
        raise SalesforceUnavailable(f"Salesforce login failed: {e}") from e


def run_salesforce_query(query: str) -> list[dict]:
    """Executes raw SOQL against Salesforce and returns plain records (auto-paginated)."""
    sf = _client()
    result = sf.query_all(query)
    records = result.get("records", [])
    # Strip the noisy "attributes" metadata Salesforce attaches to every record/sub-record.
    return [_strip_attributes(r) for r in records]


def _strip_attributes(obj):
    if isinstance(obj, dict):
        return {k: _strip_attributes(v) for k, v in obj.items() if k != "attributes"}
    if isinstance(obj, list):
        return [_strip_attributes(v) for v in obj]
    return obj
