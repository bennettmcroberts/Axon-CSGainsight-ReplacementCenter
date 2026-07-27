"""Thin read-only wrapper around the Google Sheets API for the NPS/CSAT survey pilot.

Authenticates with a service account (backend/google_credentials.json) rather
than a plain API key, so the response Sheet can stay private - it's shared
directly with the service account's client_email as Viewer. See NOTES.md /
memory for the pilot's Sheet ID and tab name; both are also overridable via
GOOGLE_SHEET_ID / GOOGLE_SHEET_TAB in backend/.env.
"""
from __future__ import annotations

from functools import lru_cache

from .config import settings

SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


class SheetsUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client():
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as e:  # pragma: no cover
        raise SheetsUnavailable("google-api-python-client is not installed") from e

    if not settings.google_sheets_configured:
        raise SheetsUnavailable(
            f"Google service account key not found at {settings.google_credentials_path}. "
            "See README.md for how to create one and share the Sheet with its client_email."
        )
    try:
        creds = service_account.Credentials.from_service_account_file(
            settings.google_credentials_path, scopes=SCOPES
        )
        return build("sheets", "v4", credentials=creds)
    except Exception as e:  # noqa: BLE001
        raise SheetsUnavailable(f"Google Sheets auth failed: {e}") from e


# Maps our internal field names to the exact Google Form question text (the
# header row). Matched case-insensitively by substring so small wording edits
# in the form don't silently break parsing - only a header being removed
# entirely drops that field (falls back to None/"").
FIELD_HEADERS = {
    "timestamp": "timestamp",
    "account": "account",
    "score": "how likely are you to recommend",
    "reason": "main driver for your score",
    "comment": "score above that threshold",
    "contact_name": "contact feedback name",
    "contact_title": "contact title",
    # The form now asks "How do you rate your customer success manager?" -
    # this is a real 1-10 CSM satisfaction score, not a CSM's name (see the
    # note in fetch_survey_responses below).
    "csat_score": "rate your customer success manager",
    # This follow-up question reuses near-identical wording to "comment"
    # above ("...what can we do to score above that threshold?..."), just
    # asked a second time after the CSM-rating question - matched below by
    # requiring it to come after the csat_score column, since text alone
    # can't tell the two apart.
    "csat_comments": "score above that threshold",
    "description": "how would you describe axon",
    "relationship_intent": "do you intend to grow",
}


def _build_header_map(header_row: list[str]) -> dict:
    mapping = {}
    lower_headers = [h.lower() for h in header_row]
    for field, needle in FIELD_HEADERS.items():
        if field == "csat_comments":
            continue
        idx = next((i for i, h in enumerate(lower_headers) if needle in h), None)
        if idx is not None:
            mapping[field] = idx
    csat_idx = mapping.get("csat_score")
    if csat_idx is not None:
        needle = FIELD_HEADERS["csat_comments"]
        idx = next((i for i, h in enumerate(lower_headers) if i > csat_idx and needle in h), None)
        if idx is not None:
            mapping["csat_comments"] = idx
    return mapping


def fetch_survey_responses() -> list[dict]:
    """Reads the NPS Form Response tab and returns parsed records, matched by
    header name (not fixed column position) so form edits don't break parsing.
    Skips the header row and any blank rows."""
    svc = _client()
    try:
        result = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=settings.google_sheet_id, range=f"{settings.google_sheet_tab}!A1:Z1000")
            .execute()
        )
    except Exception as e:  # noqa: BLE001
        raise SheetsUnavailable(f"Could not read the response Sheet: {e}") from e

    rows = result.get("values", [])
    if not rows:
        return []
    header_map = _build_header_map(rows[0])

    def get(row: list[str], field: str) -> str:
        idx = header_map.get(field)
        if idx is None or idx >= len(row):
            return ""
        return row[idx]

    records = []
    for row in rows[1:]:
        account = get(row, "account")
        if not row or not account:
            continue
        def _to_int(raw: str):
            try:
                return int(float(raw)) if raw not in (None, "") else None
            except ValueError:
                return None

        records.append(
            {
                "timestamp": get(row, "timestamp"),
                "account": account,
                "score": _to_int(get(row, "score")),
                "reason": get(row, "reason"),
                "comment": get(row, "comment"),
                "contactName": get(row, "contact_name"),
                "contactTitle": get(row, "contact_title"),
                # "CSAT CSM" is a misleadingly-named form question - the answer is
                # actually a 1-10 satisfaction rating, not a CSM's name.
                "csatScore": _to_int(get(row, "csat_score")),
                "csatComments": get(row, "csat_comments"),
                "description": get(row, "description"),
                "relationshipIntent": get(row, "relationship_intent"),
            }
        )
    return records
