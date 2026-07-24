"""FastAPI backend for the Axon CS Command Center.

Serves the static frontend and exposes a single generic SOQL passthrough
endpoint so the frontend business logic can stay identical whether it's
reading mock data or live Salesforce data.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from .auth import public_user, verify_user
from .config import settings
from .mock_engine import run_mock_query
from .salesforce_client import SalesforceUnavailable, run_salesforce_create, run_salesforce_query
from .sheets_client import SheetsUnavailable, fetch_survey_responses
from .gmail_client import GmailUnavailable, gmail_configured, send_email

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Shared JS, Resource Library pages, and other static assets live under frontend/.
FRONTEND_ASSETS_DIR = (BACKEND_DIR.parent / "frontend").resolve()
# Primary UI (Axon Yellow chrome) lives under frontend-axon/.
FRONTEND_UI_DIR = (BACKEND_DIR.parent / "frontend-axon").resolve()
# Legacy classic UI kept available at /classic/ only.
FRONTEND_CLASSIC_DIR = FRONTEND_ASSETS_DIR

app = FastAPI(title="Axon CS Command Center API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Lightweight login sessions (see app/auth.py) - a stopgap before real SSO.
# Signed, HttpOnly cookie; nothing server-side to persist beyond users.json.
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax", max_age=60 * 60 * 24 * 14)


class SoqlRequest(BaseModel):
    query: str


class WriteRequest(BaseModel):
    sobject: str
    fields: dict


class LoginRequest(BaseModel):
    username: str
    password: str


class AutomationSendRequest(BaseModel):
    to: str
    subject: str
    bodyHtml: str


def require_auth(request: Request) -> dict:
    if not request.session.get("username"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "username": request.session["username"],
        "displayName": request.session.get("display_name"),
        "csmName": request.session.get("csm_name"),
        "role": request.session.get("role", "csm"),
    }


@app.post("/api/auth/login")
def login(body: LoginRequest, request: Request):
    user = verify_user(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    pub = public_user(user)
    request.session["username"] = pub["username"]
    request.session["display_name"] = pub["displayName"]
    request.session["csm_name"] = pub["csmName"]
    request.session["role"] = pub["role"]
    return pub


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(require_auth)):
    return user


def render_app_shell(path: Path, request: Request):
    """Serves an app shell HTML file, gated by session, with the logged-in
    user's identity injected before app.js loads (so per-user localStorage
    namespacing has a username to key off of from the very first line)."""
    if not request.session.get("username"):
        next_path = request.url.path
        return RedirectResponse(url=f"/login?next={next_path}", status_code=307)
    user_json = json.dumps({
        "username": request.session["username"],
        "displayName": request.session.get("display_name"),
        "csmName": request.session.get("csm_name"),
        "role": request.session.get("role", "csm"),
    })
    html = path.read_text()
    html = html.replace("<!--AUTH_USER-->", f"<script>window.CURRENT_USER={user_json};</script>")
    return HTMLResponse(html)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "dataMode": settings.effective_mode,
        "requestedMode": settings.data_mode,
        "salesforceConfigured": settings.salesforce_configured,
    }


@app.post("/api/soql")
def soql(body: SoqlRequest, user: dict = Depends(require_auth)):
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="Missing query")

    mode = settings.effective_mode
    try:
        if mode == "salesforce":
            records = run_salesforce_query(query)
        else:
            records = run_mock_query(query)
    except SalesforceUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Query failed: {e}") from e

    return {"records": records, "totalSize": len(records), "done": True}


@app.post("/api/write")
def write_record(body: WriteRequest, user: dict = Depends(require_auth)):
    """Write-back for CSM-logged activity (calls/emails/meetings) so it lands in
    Salesforce instead of staying stranded in this app's localStorage.

    Only actually writes when running against live Salesforce (DATA_MODE=salesforce
    with valid credentials) - in mock mode there's nothing real to write to, so this
    clearly reports a simulated result rather than silently pretending to succeed.
    """
    mode = settings.effective_mode
    if mode != "salesforce":
        return {
            "written": False,
            "mode": mode,
            "detail": (
                "Mock-data mode - no live Salesforce connection is configured, so this "
                "activity was not actually written back. Set DATA_MODE=salesforce with "
                "valid credentials in backend/.env to enable real write-back."
            ),
        }
    try:
        record_id = run_salesforce_create(body.sobject, body.fields)
        return {"written": True, "mode": mode, "id": record_id}
    except SalesforceUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Write failed: {e}") from e


@app.get("/api/survey/responses")
def survey_responses(user: dict = Depends(require_auth)):
    """Real (non-mock) NPS/CSAT survey responses, read live from the Google Form's
    linked Sheet via a service account - see backend/app/sheets_client.py. This is
    a separate, small pilot data source (10 hand-picked demo accounts), not routed
    through the mock/Salesforce SOQL passthrough since it isn't a Salesforce object.
    """
    if not settings.google_sheets_configured:
        return {"records": [], "configured": False}
    try:
        records = fetch_survey_responses()
    except SheetsUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Sheet read failed: {e}") from e
    return {"records": records, "configured": True}


@app.post("/api/automation/send")
def automation_send(body: AutomationSendRequest, user: dict = Depends(require_auth)):
    """Demo send for the Automation Batch feature - fires one real email through
    the axongainsightrp@gmail.com account (see backend/gmail_client.py) so the
    Automation Settings / Escalation Automations bubbles can show a genuine sent
    confirmation instead of a faked one. Scheduling itself is not automated yet;
    this is manually triggered from the frontend when a bubble's configured date
    is reached (or immediately, for demo purposes).
    """
    if not gmail_configured():
        raise HTTPException(status_code=503, detail="Gmail not configured - run backend/gmail_auth.py once.")
    try:
        message_id = send_email(body.to, body.subject, body.bodyHtml)
    except GmailUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"sent": True, "messageId": message_id}


@app.get("/api/automation/status")
def automation_status(user: dict = Depends(require_auth)):
    return {"configured": gmail_configured()}


if FRONTEND_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="assets")

if FRONTEND_UI_DIR.exists():
    @app.get("/")
    def index():
        return FileResponse(FRONTEND_UI_DIR / "index.html")

    @app.get("/login")
    @app.get("/login.html")
    def login_page():
        return FileResponse(FRONTEND_UI_DIR / "login.html")

    @app.get("/app.html")
    def app_shell(request: Request):
        return render_app_shell(FRONTEND_UI_DIR / "app.html", request)

    # Old /axon bookmarks → primary UI
    @app.get("/axon")
    @app.get("/axon/")
    def axon_redirect():
        return RedirectResponse(url="/", status_code=307)

    @app.get("/axon/{filename}")
    def axon_file_redirect(filename: str):
        return RedirectResponse(url=f"/{filename}", status_code=307)

# Optional legacy classic UI (not linked from the primary app)
if FRONTEND_CLASSIC_DIR.exists():
    @app.get("/classic")
    @app.get("/classic/")
    def classic_index():
        return FileResponse(FRONTEND_CLASSIC_DIR / "index.html")

    @app.get("/classic/app.html")
    def classic_app_shell(request: Request):
        return render_app_shell(FRONTEND_CLASSIC_DIR / "app.html", request)

    @app.get("/classic/{filename}")
    def classic_file(filename: str):
        candidate = FRONTEND_CLASSIC_DIR / filename
        if candidate.is_file():
            return FileResponse(candidate)
        raise HTTPException(status_code=404, detail="Not found")

if FRONTEND_UI_DIR.exists():
    @app.get("/{filename}")
    def frontend_file(filename: str):
        candidate = FRONTEND_UI_DIR / filename
        if candidate.is_file():
            return FileResponse(candidate)
        # Shared files still live under frontend/ (e.g. theme helpers if ever linked at root)
        shared = FRONTEND_ASSETS_DIR / filename
        if shared.is_file():
            return FileResponse(shared)
        raise HTTPException(status_code=404, detail="Not found")
