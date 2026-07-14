@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv" (
  echo Creating virtual environment...
  python -m venv .venv
)

call .venv\Scripts\activate.bat

echo Installing/updating dependencies...
pip install -q -r requirements.txt

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created backend\.env from .env.example - edit it to switch to live Salesforce later.
)

echo.
echo Starting Axon CS Command Center at http://127.0.0.1:8420
echo Press Ctrl+C to stop.
echo.
start "" "http://127.0.0.1:8420"
uvicorn app.main:app --host 127.0.0.1 --port 8420

endlocal
