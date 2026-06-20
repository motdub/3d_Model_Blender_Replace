@echo off
REM ===========================================================================
REM  3D Model Creator - One-click launcher
REM  Double-click this file to:
REM    1. Install dependencies (first run only)
REM    2. Start the Vite dev server
REM    3. Open the app in your DEFAULT web browser (Vivaldi, Edge, Brave,
REM       Coc Coc, Chrome, etc. - whatever you have set as default)
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

REM --- Start the dev server AND open the page in the DEFAULT browser ---
REM Vite's --open flag opens your default browser (Vivaldi, Edge, Brave,
REM Coc Coc, Chrome, etc.) at the correct URL once the server is ready.
echo [SERVER] Starting Vite dev server and opening your default browser...
echo [INFO] Press Ctrl+C in this window to stop the server.
echo.
call npm run dev -- --open

pause
