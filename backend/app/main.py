"""FastAPI backend for the Axon CS Command Center.

Serves the static frontend and exposes a single generic SOQL passthrough
endpoint so the frontend business logic can stay identical whether it's
reading mock data or live Salesforce data.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
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
from .gmail_client import GmailUnavailable, gmail_configured, get_message_body, list_recent_inbox, send_email
from .ai_client import answer_org_config_chat, draft_email, generate_predictive_insight, interpret_reply

BACKEND_DIR = Path(__file__).resolve().parent.parent
# AI-drafted-email hand-off files (see backend/app/main.py's ai-draft endpoints
# below) - deliberately limited to the 10 NPS/CSAT pilot accounts (same list
# as TEST10_ACCOUNTS in frontend/app.js) while this stays a manual, Claude
# Code-in-the-loop feature rather than a live API integration.
AI_DRAFTS_DIR = BACKEND_DIR / "data" / "ai_drafts"
AI_DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
# Same human-in-the-loop hand-off pattern as ai_drafts, just inverted: the
# frontend registers "this CTA is waiting on a reply" here when its email is
# sent, then polls. A live Claude Code session (with real Gmail read access
# now that gmail_client's OAuth token has the readonly scope) checks the
# inbox via /api/gmail/inbox + /api/gmail/message/{id}, decides whether the
# reply means the CTA is resolved, and writes that decision back into the
# same file - which is what actually "auto-completes" the chevron chain.
REPLY_WATCH_DIR = BACKEND_DIR / "data" / "reply_watch"
REPLY_WATCH_DIR.mkdir(parents=True, exist_ok=True)
# Same human-in-the-loop pattern again, for Predictive Insights: the backend
# embeds the account's own "Test10 background and current info for {name}"
# file (in the project root) directly into the pending request, so whichever
# Claude Code session fulfills it has the fabricated history right there
# without a separate file lookup.
PREDICTIVE_INSIGHTS_DIR = BACKEND_DIR / "data" / "predictive_insights"
PREDICTIVE_INSIGHTS_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_ROOT = BACKEND_DIR.parent
TEST10_ACCOUNTS = [
    "Springfield Fire & Rescue", "Union City Correctional Facility", "Zionsville Highway Patrol",
    "Kingsley Fire & Rescue", "Westgate Correctional Facility", "Harborview Fire & Rescue",
    "Georgetown Public Safety Dept.", "Jasper County Sheriff's Office", "Thornbury Highway Patrol",
    "Lakewood Correctional Facility",
]
_AI_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
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


class AiDraftRequest(BaseModel):
    accountName: str
    category: str
    context: str


class ReplyWatchRequest(BaseModel):
    accountName: str
    ctaId: str
    sentSubject: str
    sentAt: str


class PredictiveInsightRequest(BaseModel):
    accountName: str
    quarter: str
    recentEventSummary: str


class OrgConfigChatRequest(BaseModel):
    message: str
    currentConfig: str  # JSON string - the active bundle, so the model proposes a diff not a rewrite
    history: list = []  # prior turns [{role, text, diff}] - makes this a continuous conversation, not one-shot


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


def _ai_draft_path(request_id: str) -> Path:
    if not _AI_REQUEST_ID_RE.match(request_id):
        raise HTTPException(status_code=400, detail="Invalid request id")
    return AI_DRAFTS_DIR / f"{request_id}.json"


@app.post("/api/ai-draft/{request_id}")
def create_ai_draft_request(request_id: str, body: AiDraftRequest, user: dict = Depends(require_auth)):
    """A CSM clicks "Create AI draft," optionally typing extra context first;
    that context is combined with the account's own background file and sent
    to the real model, which drafts the email itself. If ANTHROPIC_API_KEY
    isn't set, falls back to the human-in-the-loop hand-off (a Claude Code
    session reads this same pending file and writes the draft back).
    Deliberately limited to the 10 NPS/CSAT pilot accounts."""
    if body.accountName not in TEST10_ACCOUNTS:
        raise HTTPException(status_code=403, detail="AI drafts are limited to the 10 pilot accounts for now")
    ctx_path = PROJECT_ROOT / f"Test10 background and current info for {body.accountName}.md"
    background_text = ctx_path.read_text() if ctx_path.is_file() else ""
    path = _ai_draft_path(request_id)
    data = {
        "status": "pending",
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        "requestedBy": user["username"],
        "accountName": body.accountName,
        "category": body.category,
        "context": body.context,
        "draft": None,
    }
    if settings.anthropic_configured:
        try:
            data["draft"] = draft_email(body.accountName, body.category, body.context, background_text)
            data["status"] = "ready"
        except Exception as e:  # noqa: BLE001
            data["status"] = "pending"
            data["error"] = f"AI drafting failed, falling back to manual: {e}"
    path.write_text(json.dumps(data, indent=2))
    return data


@app.get("/api/ai-draft/{request_id}")
def get_ai_draft_request(request_id: str, user: dict = Depends(require_auth)):
    path = _ai_draft_path(request_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return json.loads(path.read_text())


@app.get("/api/gmail/inbox")
def gmail_inbox(max_results: int = 15, user: dict = Depends(require_auth)):
    """Raw recent-inbox read - for a live Claude Code session to call directly
    (curl) while attending the Test10 demo, to find a reply to match against
    an open reply-watch. Not used by the frontend UI itself."""
    if not gmail_configured():
        raise HTTPException(status_code=503, detail="Gmail not configured - run backend/gmail_auth.py once.")
    try:
        return {"messages": list_recent_inbox(max_results)}
    except GmailUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.get("/api/gmail/message/{message_id}")
def gmail_message(message_id: str, user: dict = Depends(require_auth)):
    if not gmail_configured():
        raise HTTPException(status_code=503, detail="Gmail not configured - run backend/gmail_auth.py once.")
    try:
        return {"body": get_message_body(message_id)}
    except GmailUnavailable as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


def _reply_watch_path(cta_id: str) -> Path:
    if not _AI_REQUEST_ID_RE.match(cta_id):
        raise HTTPException(status_code=400, detail="Invalid CTA id")
    return REPLY_WATCH_DIR / f"{cta_id}.json"


@app.post("/api/reply-watch/{cta_id}")
def create_reply_watch(cta_id: str, body: ReplyWatchRequest, user: dict = Depends(require_auth)):
    if body.accountName not in TEST10_ACCOUNTS:
        raise HTTPException(status_code=403, detail="Reply watching is limited to the 10 pilot accounts for now")
    path = _reply_watch_path(cta_id)
    data = {
        "status": "pending",
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        "accountName": body.accountName,
        "ctaId": body.ctaId,
        "sentSubject": body.sentSubject,
        "sentAt": body.sentAt,
        "replySnippet": None,
        "note": None,
    }
    path.write_text(json.dumps(data, indent=2))
    return data


@app.get("/api/reply-watch/{cta_id}")
def get_reply_watch(cta_id: str, user: dict = Depends(require_auth)):
    path = _reply_watch_path(cta_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return json.loads(path.read_text())


async def _reply_watch_poll_once():
    """One pass over every pending reply-watch file: pulls the inbox once
    (not once per file), matches by subject (Re:/Fwd: stripped), and - only
    when ANTHROPIC_API_KEY is set - asks the model whether the reply actually
    means the CTA is resolved before marking it ready. No key configured =
    no automatic decision here; the file just waits for the manual
    Claude-Code-in-the-loop path instead."""
    if not gmail_configured():
        return
    pending = []
    for f in REPLY_WATCH_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
        except Exception:  # noqa: BLE001
            continue
        if data.get("status") == "pending":
            pending.append((f, data))
    if not pending:
        return
    try:
        inbox = list_recent_inbox(20)
    except GmailUnavailable:
        return
    for f, data in pending:
        sent_subject = re.sub(r"^(re|fwd):\s*", "", (data.get("sentSubject") or ""), flags=re.I).strip().lower()
        if not sent_subject:
            continue
        match = None
        for m in inbox:
            subj = re.sub(r"^(re|fwd):\s*", "", m.get("subject") or "", flags=re.I).strip().lower()
            if subj and sent_subject in subj:
                match = m
                break
        if not match:
            continue
        try:
            body = get_message_body(match["id"])
        except GmailUnavailable:
            continue
        if settings.anthropic_configured:
            # Flip to "reading" the instant a matching reply is found, before
            # the (real, sometimes multi-second) interpret_reply call below -
            # gives the frontend poll something to actually observe in
            # between "waiting for a reply" and "resolved", so a CSM watching
            # the chevron sees a real interim state instead of a blind jump.
            data["status"] = "reading"
            f.write_text(json.dumps(data, indent=2))
            try:
                decision = interpret_reply(data.get("accountName", ""), data.get("sentSubject", ""), body)
            except Exception as e:  # noqa: BLE001
                decision = {"resolved": False, "note": f"(AI interpretation failed: {e})"}
        else:
            # No model configured - can't judge intent automatically, leave pending for the manual path.
            continue
        if decision.get("resolved"):
            data["status"] = "ready"
            data["note"] = decision.get("note", "")
            data["replySnippet"] = match.get("snippet", "")
            f.write_text(json.dumps(data, indent=2))
        else:
            # Not resolved yet (e.g. reply didn't actually confirm) - back to
            # pending so the next pass can re-check without getting stuck
            # showing "reading" forever.
            data["status"] = "pending"
            f.write_text(json.dumps(data, indent=2))


async def _reply_watch_poller_loop():
    while True:
        try:
            await _reply_watch_poll_once()
        except Exception:  # noqa: BLE001
            pass  # best-effort background loop - never let one bad pass kill it
        await asyncio.sleep(30)


@app.on_event("startup")
async def _start_reply_watch_poller():
    asyncio.create_task(_reply_watch_poller_loop())


def _predictive_insight_path(request_id: str) -> Path:
    if not _AI_REQUEST_ID_RE.match(request_id):
        raise HTTPException(status_code=400, detail="Invalid request id")
    return PREDICTIVE_INSIGHTS_DIR / f"{request_id}.json"


@app.post("/api/predictive-insight/{request_id}")
def create_predictive_insight_request(request_id: str, body: PredictiveInsightRequest, user: dict = Depends(require_auth)):
    """Reads the account's own context file straight off disk (project root)
    and, if ANTHROPIC_API_KEY is set, calls the real model synchronously and
    returns the finished insight immediately - no waiting on anyone. Without a
    key configured, falls back to the human-in-the-loop hand-off: a Claude
    Code session reads this same pending file and writes the insight back."""
    if body.accountName not in TEST10_ACCOUNTS:
        raise HTTPException(status_code=403, detail="Predictive insights are limited to the 10 pilot accounts for now")
    ctx_path = PROJECT_ROOT / f"Test10 background and current info for {body.accountName}.md"
    context_text = ctx_path.read_text() if ctx_path.is_file() else ""
    path = _predictive_insight_path(request_id)
    data = {
        "status": "pending",
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        "requestedBy": user["username"],
        "accountName": body.accountName,
        "quarter": body.quarter,
        "recentEventSummary": body.recentEventSummary,
        "contextFile": str(ctx_path),
        "contextText": context_text,
        "insight": None,
    }
    if settings.anthropic_configured:
        try:
            data["insight"] = generate_predictive_insight(body.accountName, context_text, body.recentEventSummary)
            data["status"] = "ready"
        except Exception as e:  # noqa: BLE001
            data["status"] = "pending"
            data["error"] = f"AI generation failed, falling back to manual: {e}"
    path.write_text(json.dumps(data, indent=2))
    return data


@app.get("/api/predictive-insight/{request_id}")
def get_predictive_insight_request(request_id: str, user: dict = Depends(require_auth)):
    path = _predictive_insight_path(request_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return json.loads(path.read_text())


ORG_CONFIGS_DIR = PROJECT_ROOT / "org_configs"


def _load_org_docs() -> dict:
    docs = {}
    if ORG_CONFIGS_DIR.is_dir():
        for f in sorted(ORG_CONFIGS_DIR.glob("org_ref_*.md")):
            docs[f.stem.replace("org_ref_", "")] = f.read_text()
    return docs


@app.post("/api/org-config-chat")
def org_config_chat(body: OrgConfigChatRequest, user: dict = Depends(require_auth)):
    """Configure Org Data's chat feature - real, synchronous Claude call.
    Combines the CSM's request with all 5 org reference docs and the
    currently active config, and gets back a diff strictly in the existing
    config shape (or an honest "doesn't fit" explanation)."""
    if not settings.anthropic_configured:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY not set in backend/.env - this feature needs a real model call, there's no manual fallback for it.")
    org_docs = _load_org_docs()
    if not org_docs:
        raise HTTPException(status_code=404, detail=f"No org_ref_*.md files found in {ORG_CONFIGS_DIR}")
    try:
        return answer_org_config_chat(body.message, body.currentConfig, org_docs, body.history)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Chat request failed: {e}") from e


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
