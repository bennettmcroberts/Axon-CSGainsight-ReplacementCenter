"""Environment-driven configuration for the Axon CS Command Center backend."""
from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class Settings:
    """Simple settings object read once at import time."""

    def __init__(self) -> None:
        self.data_mode = (os.getenv("DATA_MODE", "mock") or "mock").strip().lower()
        self.sf_username = _clean(os.getenv("SF_USERNAME"))
        self.sf_password = _clean(os.getenv("SF_PASSWORD"))
        self.sf_security_token = _clean(os.getenv("SF_SECURITY_TOKEN"))
        # "login" for production/dev orgs, "test" for sandboxes, or a My Domain prefix.
        self.sf_domain = _clean(os.getenv("SF_DOMAIN")) or "login"
        self.mock_seed = int(os.getenv("MOCK_SEED", "42"))
        self.mock_account_count = int(os.getenv("MOCK_ACCOUNT_COUNT", "64"))
        self.port = int(os.getenv("PORT", "8420"))
        # Google Sheets read-only pilot (NPS/CSAT survey responses via a Google Form).
        self.google_credentials_path = _clean(os.getenv("GOOGLE_CREDENTIALS_PATH")) or str(
            BACKEND_DIR / "google_credentials.json"
        )
        self.google_sheet_id = _clean(os.getenv("GOOGLE_SHEET_ID")) or "1wNpqWj4vG5BVa-q9k4omC5zHNBlCl3p-u7_ee7qCj3w"
        self.google_sheet_tab = _clean(os.getenv("GOOGLE_SHEET_TAB")) or "NPS Form Response"
        session_secret = _clean(os.getenv("SESSION_SECRET"))
        if not session_secret:
            session_secret = secrets.token_hex(32)
            print(
                "WARNING: SESSION_SECRET not set in backend/.env - generated a random one "
                "for this run. Everyone will be logged out on restart. Set SESSION_SECRET "
                "in backend/.env for logins to persist across restarts.",
                file=sys.stderr,
            )
        self.session_secret = session_secret

    @property
    def salesforce_configured(self) -> bool:
        return bool(self.sf_username and self.sf_password and self.sf_security_token)

    @property
    def google_sheets_configured(self) -> bool:
        return os.path.isfile(self.google_credentials_path)

    @property
    def effective_mode(self) -> str:
        """Falls back to mock data if Salesforce mode is requested but not configured."""
        if self.data_mode == "salesforce" and not self.salesforce_configured:
            return "mock"
        return self.data_mode


settings = Settings()
