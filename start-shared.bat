@echo off
setlocal enabledelayedexpansion
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

rem Best-effort auto-detect of this PC's LAN IPv4 address, just to print a
rem ready-to-share URL. If this fails, run "ipconfig" yourself and look for
rem "IPv4 Address" under your active Wi-Fi/Ethernet adapter.
set LANIP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  if not defined LANIP set LANIP=%%a
)
if defined LANIP set LANIP=%LANIP: =%

echo.
echo ============================================================
echo   Axon CS Command Center - SHARED on your local network
echo.
echo   On this PC:                 http://127.0.0.1:8420
if defined LANIP (
  echo   Share this with teammates:  http://%LANIP%:8420
) else (
  echo   Could not auto-detect your LAN IP - run "ipconfig" and look
  echo   for "IPv4 Address" under your active network adapter.
)
echo.
echo   First run only: if Windows shows a firewall prompt for Python
echo   or uvicorn, click "Allow access" (Private networks at least).
echo.
echo   This is only reachable by other devices on the SAME network as
echo   this PC, and only while this window stays open. Press Ctrl+C to
echo   stop sharing.
echo ============================================================
echo.
start "" "http://127.0.0.1:8420"
uvicorn app.main:app --host 0.0.0.0 --port 8420

endlocal
