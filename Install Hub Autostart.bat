@echo off
title Install Hub autostart
rem Makes the Hub start (in the background, no window) when Windows starts. It then starts the projects you switched on
rem with "Start with PC" on the dashboard. Nothing else on your PC is changed. Undo with "Remove Hub Autostart.bat".
cd /d "%~dp0"
if not defined HUB_STARTUP_DIR set "HUB_STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%~dp0tools\dashboard\startup\hub-boot.vbs"
if not exist "%VBS%" (
  echo Could not find %VBS%. Keep this file in the main Hub folder.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:HUB_STARTUP_DIR + '\Hub Dashboard.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"' + $env:VBS + '\"'; $s.WorkingDirectory=(Get-Location).Path; $s.Description='Starts the Hub dashboard in the background'; $s.Save()"
if errorlevel 1 (
  echo Could not create the start-up entry.
  pause
  exit /b 1
)
echo.
echo Done. The Hub will now start in the background when Windows starts.
echo Open the dashboard with "Start Hub Dashboard.bat" and switch on "Start with PC" for the projects you want.
echo To undo this, run "Remove Hub Autostart.bat".
echo.
pause
