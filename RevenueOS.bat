@echo off
rem RevenueOS - double-click to start everything (dashboard + local worker + built-in database).
rem First run: installs what is needed, then opens the installer in your browser.
setlocal EnableExtensions
cd /d "%~dp0"
title RevenueOS

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js 20 or newer is required and was not found.
  echo  Opening the download page. Install the LTS version, then double-click RevenueOS.bat again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Enabling pnpm ^(package manager^)...
  call corepack enable >nul 2>nul
)
where pnpm >nul 2>nul
if errorlevel 1 (
  call npm install -g pnpm@10 >nul 2>nul
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo Could not install pnpm automatically. Run "npm install -g pnpm" in a terminal and try again.
  pause
  exit /b 1
)

if not exist "node_modules\.pnpm" (
  echo.
  echo  Installing RevenueOS - first run only, this takes a few minutes...
  echo.
  call pnpm install
  if errorlevel 1 (
    echo Installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist "%USERPROFILE%\Desktop\RevenueOS.lnk" if not exist ".data\no-shortcut" (
  choice /C YN /N /M "Create a RevenueOS shortcut on the desktop? [Y/N] "
  if errorlevel 2 (
    if not exist ".data" mkdir ".data"
    type nul > ".data\no-shortcut"
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\RevenueOS.lnk'); $s.TargetPath='%~dp0RevenueOS.bat'; $s.WorkingDirectory='%~dp0'; $s.Description='RevenueOS'; $s.Save()"
  )
)

node --import tsx scripts\launcher.ts %*
if errorlevel 1 pause
