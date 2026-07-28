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
SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]


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


def list_recent_inbox(max_results: int = 15) -> list[dict]:
    """Returns the most recent inbox messages (subject/from/date/snippet),
    newest first - used to find a reply to a Test10 demo send. Metadata-only
    fetch (no body) so this stays fast; call get_message_body for the full text."""
    svc = _service()
    try:
        listing = svc.users().messages().list(userId="me", labelIds=["INBOX"], maxResults=max_results).execute()
        out = []
        for m in listing.get("messages", []):
            msg = svc.users().messages().get(
                userId="me", id=m["id"], format="metadata", metadataHeaders=["Subject", "From", "Date"]
            ).execute()
            headers = {h["name"]: h["value"] for h in msg.get("payload", {}).get("headers", [])}
            out.append({
                "id": m["id"],
                "threadId": msg.get("threadId", ""),
                "subject": headers.get("Subject", ""),
                "from": headers.get("From", ""),
                "date": headers.get("Date", ""),
                "snippet": msg.get("snippet", ""),
            })
        return out
    except Exception as e:  # noqa: BLE001
        raise GmailUnavailable(f"Inbox read failed: {e}") from e


def get_message_body(message_id: str) -> str:
    """Returns the plain-text body of one message (falls back to the snippet
    if no text/plain part is found - good enough for a short reply)."""
    svc = _service()
    try:
        msg = svc.users().messages().get(userId="me", id=message_id, format="full").execute()
    except Exception as e:  # noqa: BLE001
        raise GmailUnavailable(f"Message read failed: {e}") from e

    def _walk(part) -> str | None:
        if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
        for sub in part.get("parts", []) or []:
            found = _walk(sub)
            if found:
                return found
        return None

    body = _walk(msg.get("payload", {})) or msg.get("snippet", "")
    return body
