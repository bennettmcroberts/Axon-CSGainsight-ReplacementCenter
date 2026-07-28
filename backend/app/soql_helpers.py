"""Small regex helpers shared by every SOQL-shape dispatcher (mock, Snowflake, hybrid).

The frontend sends a fixed set of SOQL query "shapes" (see mock_engine.py's module
docstring) rather than arbitrary queries, so every backend that serves /api/soql
needs to pull the same two things out of the query text: the IN-list of account IDs
for aggregate queries, and the single AccountId for per-account detail queries.
"""
from __future__ import annotations

import re


def extract_quoted(text: str) -> list[str]:
    return re.findall(r"'([A-Za-z0-9_]+)'", text)


def single_account_id(query: str) -> str | None:
    m = re.search(r"AccountId\s*=\s*'([A-Za-z0-9_]+)'", query)
    return m.group(1) if m else None
