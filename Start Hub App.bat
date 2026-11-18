@echo off
rem Double-click to open the Hub in its own window (the Hub app, Phase 16). If the dashboard is not running yet, the app starts it,
rem and stops it again when you quit the app. Nothing stays open here: this window closes by itself.
cd /d "%~dp0"

if not exist "toolsapp
ode_moduleselectrondistelectron.exe" (
  echo Run npm install in toolsapp first.
  pause
  exit /b 1
)

start "" "%~dp0toolsapp
ode_moduleselectrondistelectron.exe" "%~dp0toolsapp"
exit /b 0
