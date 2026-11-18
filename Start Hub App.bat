@echo off
rem Double-click to open the Hub in its own window (the Hub app, Phase 16). If the dashboard is not running yet, the app starts it,
rem and stops it again when you quit the app. Nothing stays open here: this window closes by itself.
rem Quit Hub (in the background icon menu) also stops every project the Hub started; the X button only hides the window.
rem Start with Windows: the switch in the background icon menu (it starts the app with --hidden). No other start-up file is needed.
cd /d "%~dp0"

if not exist "tools\app\node_modules\electron\dist\electron.exe" (
  echo Run npm install in tools\app first.
  pause
  exit /b 1
)

start "" "%~dp0tools\app\node_modules\electron\dist\electron.exe" "%~dp0tools\app"
exit /b 0
