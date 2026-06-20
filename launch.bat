@echo off
REM ===========================================================================
REM  3D Model Creator - One-click launcher
REM  Double-click this file to:
REM    1. Install dependencies (first run only)
REM    2. Start the Vite dev server
REM    3. Open the app in your default Chrome-based browser
REM ===========================================================================

title 3D Model Creator
cd /d "%~dp0"

echo ============================================================
echo   3D Model Creator - Starting up...
echo ============================================================
echo.

REM --- Make sure Node.js / npm is available ---
where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on your PATH.
  echo Please install Node.js from https://nodejs.org/ and try again.
  echo.
  pause
  exit /b 1
)

REM --- Install dependencies only if node_modules is missing ---
if not exist "node_modules" (
  echo [SETUP] Installing dependencies ^(first run only^)...
  call npm install
  echo.
)

REM --- Open the browser shortly after the server starts ---
echo [LAUNCH] Opening http://localhost:5173/ in your browser...
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start chrome http://localhost:5173/ || start http://localhost:5173/"

REM --- Start the dev server (this window stays open; press Ctrl+C to stop) ---
echo [SERVER] Starting Vite dev server. Press Ctrl+C in this window to stop.
echo.
call npm run dev

pause
