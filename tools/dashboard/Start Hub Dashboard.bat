@echo off
title Hub dashboard
rem Double-click to start the Hub dashboard and open it in your browser. Close this window to stop it.
rem Add the word "demo" after the file name to run on made-up sample data instead of your real projects.
cd /d "%~dp0..\.."

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found on this PC, so the dashboard cannot start.
  pause
  exit /b 1
)

set URL=http://127.0.0.1:4780
set MODE=
if /i "%~1"=="demo" set MODE=--demo

rem already running? then just open it
curl -s -m 2 -o nul %URL%/ >nul 2>&1
if not errorlevel 1 (
  echo The dashboard is already running. Opening it.
  if /i not "%~1"=="nobrowser" start "" %URL%
  exit /b 0
)

if /i not "%~1"=="nobrowser" start "" cmd /c "timeout /t 2 /nobreak >nul & start "" %URL%"
echo Starting the Hub dashboard at %URL%  (this window must stay open)
node tools\dashboard\server.mjs %MODE%
echo.
echo The dashboard stopped.
pause
