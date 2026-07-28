"""One-time local authorization for the Gmail send demo.

Run this once from the backend/ directory:

    python3 gmail_auth.py

It opens a browser, asks you to log into axongainsightrp@gmail.com, and asks
you to grant send-only permission (gmail.send scope). Approving it writes
gmail_token.json (a refresh token) next to this script - the backend then
uses that file to send mail without any further logins. Re-run this script
only if gmail_token.json is deleted or the grant is revoked.
"""
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]
BACKEND_DIR = Path(__file__).resolve().parent
CLIENT_SECRET_PATH = BACKEND_DIR / "gmail_client_secret.json"
TOKEN_PATH = BACKEND_DIR / "gmail_token.json"

if __name__ == "__main__":
    if not CLIENT_SECRET_PATH.is_file():
        raise SystemExit(f"Missing {CLIENT_SECRET_PATH} - place the downloaded OAuth client JSON there first.")
    flow = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET_PATH), SCOPES)
    creds = flow.run_local_server(port=8765, open_browser=False)
    TOKEN_PATH.write_text(creds.to_json())
    print(f"Saved refresh token to {TOKEN_PATH}. You're done - the backend can now send mail as this account.")
