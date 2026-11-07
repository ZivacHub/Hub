@echo off
title Remove Hub autostart
rem Undoes "Install Hub Autostart.bat": the Hub no longer starts with Windows.
if not defined HUB_STARTUP_DIR set "HUB_STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%HUB_STARTUP_DIR%\Hub Dashboard.lnk" (
  del "%HUB_STARTUP_DIR%\Hub Dashboard.lnk"
  echo Done. The Hub will no longer start with Windows.
) else (
  echo The Hub was not set to start with Windows. Nothing to remove.
)
echo.
pause
