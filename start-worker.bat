@echo off
REM Starts the RevenueOS local worker (double-click). Pass /hidden to run without a console window.
setlocal
set "ARGS="
if /I "%~1"=="/hidden" set "ARGS=-Hidden"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-worker.ps1" %ARGS% -OpenPanel
if errorlevel 1 pause
