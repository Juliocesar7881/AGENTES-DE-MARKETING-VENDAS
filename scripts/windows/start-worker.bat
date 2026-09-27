@echo off
REM Same as the start-worker.bat in the repository root.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-worker.ps1" -OpenPanel
if errorlevel 1 pause
