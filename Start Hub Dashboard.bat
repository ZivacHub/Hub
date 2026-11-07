@echo off
title Hub dashboard
rem Double-click to start the Hub dashboard; it opens in your browser by itself. Close this window to stop it.
rem "boot" is used by the Windows start-up entry (no browser, starts the projects switched on with "Start with PC").
rem Add the word "demo" after the file name to run on made-up sample data instead of your real projects.
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this PC, so the dashboard cannot start.
  pause
  exit /b 1
)

if not exist "tools\dashboard\server.mjs" (
  echo Could not find tools\dashboard\server.mjs next to this file. Keep this file in the main Hub folder.
  pause
  exit /b 1
)

set URL=http://127.0.0.1:4780
set MODE=
set OPEN=--open
if /i "%~1"=="demo" set MODE=--demo
set BOOT=
if /i "%~1"=="nobrowser" set OPEN=
if /i "%~1"=="boot" set OPEN=& set BOOT=--boot

rem already running? then just open it
curl -s -m 2 -o nul %URL%/ >nul 2>&1
if not errorlevel 1 (
  echo The dashboard is already running. Opening it.
  if defined OPEN start "" %URL%
  exit /b 0
)

echo Starting the Hub dashboard at %URL%  (this window must stay open; the page opens when it is ready)
node tools\dashboard\server.mjs %OPEN% %MODE% %BOOT%
echo.
echo The dashboard stopped. Any error is shown above.
pause
