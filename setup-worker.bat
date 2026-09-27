@echo off
REM Runs the RevenueOS worker setup (dependency check, install, encrypted credentials).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-worker.ps1"
pause
