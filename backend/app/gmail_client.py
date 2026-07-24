"""Thin wrapper around the Gmail API for the automation email demo.

Sends real mail as axongainsightrp@gmail.com using an OAuth refresh token
(gmail_token.json, produced once via backend/gmail_auth.py) rather than a
service account - Gmail send-as-a-user requires per-user consent, which a
bare service account can't do without Workspace domain-wide delegation.
"""
from __future__ import annotations

import base64
from email.mime.text import MIMEText
from functools import lru_cache
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
TOKEN_PATH = BACKEND_DIR / "gmail_token.json"
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailUnavailable(RuntimeError):
    pass


def gmail_configured() -> bool:
    return TOKEN_PATH.is_file()


@lru_cache(maxsize=1)
def _service():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError as e:  # pragma: no cover
        raise GmailUnavailable("google-auth-oauthlib/google-api-python-client is not installed") from e

    if not gmail_configured():
        raise GmailUnavailable(
            f"No Gmail token at {TOKEN_PATH}. Run `python3 gmail_auth.py` from backend/ once to authorize."
        )
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json())
    try:
        return build("gmail", "v1", credentials=creds)
    except Exception as e:  # noqa: BLE001
        raise GmailUnavailable(f"Gmail auth failed: {e}") from e


def send_email(to_addr: str, subject: str, body_html: str) -> str:
    """Sends body_html as a real email. Returns the Gmail message id."""
    svc = _service()
    msg = MIMEText(body_html, "html")
    msg["to"] = to_addr
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        result = svc.users().messages().send(userId="me", body={"raw": raw}).execute()
    except Exception as e:  # noqa: BLE001
        raise GmailUnavailable(f"Send failed: {e}") from e
    return result.get("id", "")
