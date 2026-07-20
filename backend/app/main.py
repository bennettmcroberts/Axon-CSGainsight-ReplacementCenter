"""FastAPI backend for the Axon CS Command Center.

Serves the static frontend and exposes a single generic SOQL passthrough
endpoint so the frontend business logic can stay identical whether it's
reading mock data or live Salesforce data.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import settings
from .mock_engine import run_mock_query
from .salesforce_client import SalesforceUnavailable, run_salesforce_create, run_salesforce_query

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


class SoqlRequest(BaseModel):
    query: str


class WriteRequest(BaseModel):
    sobject: str
    fields: dict


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "dataMode": settings.effective_mode,
        "requestedMode": settings.data_mode,
        "salesforceConfigured": settings.salesforce_configured,
    }


@app.post("/api/soql")
def soql(body: SoqlRequest):
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
def write_record(body: WriteRequest):
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


if FRONTEND_ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="assets")

if FRONTEND_UI_DIR.exists():
    @app.get("/")
    def index():
        return FileResponse(FRONTEND_UI_DIR / "index.html")

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
