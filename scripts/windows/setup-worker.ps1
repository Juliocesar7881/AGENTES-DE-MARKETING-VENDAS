<#
.SYNOPSIS
  Sets up the RevenueOS local worker on Windows (render + AI worker).

.DESCRIPTION
  Safe to run more than once. It never deletes files and never changes system
  settings without asking. Steps:
    1. Checks Windows, Node.js (20+), pnpm and free disk space.
    2. Installs project dependencies (pnpm install) - includes FFmpeg (bundled with Remotion).
    3. Configures the database connection. Secrets are stored encrypted with
       Windows DPAPI (only your Windows user can decrypt them) in
       %APPDATA%\RevenueOS\worker.secrets.dpapi - never in plain text.
    4. Runs the dependency check (includes a real 3-second test render).
    5. Optionally creates a Desktop shortcut and optionally enables
       "start with Windows" (both off unless you answer yes).

.PARAMETER NonInteractive
  Do not prompt; use the existing .env / saved configuration.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\setup-worker.ps1
#>
[CmdletBinding()]
param(
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigDir = Join-Path $env:APPDATA "RevenueOS"
$SecretsFile = Join-Path $ConfigDir "worker.secrets.dpapi"
$EnvWorkerFile = Join-Path $RepoRoot ".env.worker"

function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [ok] $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  [!]  $Text" -ForegroundColor Yellow }
function Write-Fail([string]$Text) { Write-Host "  [x]  $Text" -ForegroundColor Red }

function Ask-YesNo([string]$Question, [bool]$Default = $false) {
  if ($NonInteractive) { return $Default }
  $suffix = "[y/N]"
  if ($Default) { $suffix = "[Y/n]" }
  $answer = Read-Host "  $Question $suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim().ToLower().StartsWith("y") -or $answer.Trim().ToLower().StartsWith("s")
}

function Read-DotEnv([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) { return $values }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$') {
      $v = $Matches[2]
      if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) { $v = $v.Substring(1, $v.Length - 2) }
      $values[$Matches[1]] = $v
    }
  }
  return $values
}

function Protect-Value([Security.SecureString]$Secure) {
  # DPAPI (CurrentUser scope): only this Windows account on this computer can decrypt.
  return ConvertFrom-SecureString -SecureString $Secure
}

Write-Host ""
Write-Host "RevenueOS - Local Worker setup" -ForegroundColor White
Write-Host "Repository: $RepoRoot"

# ---------------------------------------------------------------- 1. System
Write-Step "Checking this computer"
$os = [Environment]::OSVersion
Write-Ok "Windows $($os.Version)"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Fail "Node.js was not found."
  Write-Host "     Install Node.js 20 LTS (or newer) and run this script again:"
  Write-Host "       winget install OpenJS.NodeJS.LTS      (or download from https://nodejs.org)"
  exit 1
}
$nodeVersion = (& node --version).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  Write-Fail "Node.js $nodeVersion is too old (20 or newer required)."
  Write-Host "       winget upgrade OpenJS.NodeJS.LTS"
  exit 1
}
Write-Ok "Node.js $nodeVersion"

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Warn2 "pnpm was not found."
  if (Ask-YesNo "Enable pnpm through Corepack (ships with Node.js)?" $true) {
    & corepack enable
    & corepack prepare pnpm@10 --activate
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  }
  if (-not $pnpm) {
    Write-Fail "pnpm is required. Install it with: npm install -g pnpm"
    exit 1
  }
}
Write-Ok "pnpm $((& pnpm --version).Trim())"

$defaultRenderDir = Join-Path $env:USERPROFILE "RevenueOS\renders"
if (Test-Path "D:\") { $defaultRenderDir = "D:\RevenueOS\renders" }
$driveRoot = [IO.Path]::GetPathRoot($defaultRenderDir)
try {
  $drive = New-Object IO.DriveInfo($driveRoot)
  $freeGb = [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
  if ($freeGb -lt 5) { Write-Warn2 "Only $freeGb GB free on $driveRoot - renders need space (about 5-20 MB per video)." }
  else { Write-Ok "$freeGb GB free on $driveRoot (render folder: $defaultRenderDir)" }
} catch {
  Write-Warn2 "Could not read free space on $driveRoot"
}

# ---------------------------------------------------------------- 2. Dependencies
Write-Step "Installing dependencies (pnpm install)"
Push-Location $RepoRoot
try {
  & pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }
  Write-Ok "Dependencies installed (FFmpeg comes bundled with Remotion)"
} finally {
  Pop-Location
}

# ---------------------------------------------------------------- 3. Connection
Write-Step "Connecting the worker to your RevenueOS database"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$dotenv = Read-DotEnv (Join-Path $RepoRoot ".env")
$haveEnvSecrets = $dotenv.ContainsKey("DATABASE_URL") -and $dotenv.ContainsKey("APP_ENCRYPTION_KEY")
$haveDpapi = Test-Path $SecretsFile

if ($haveEnvSecrets) {
  Write-Ok "Using DATABASE_URL and APP_ENCRYPTION_KEY from .env (same computer as the dashboard)."
} elseif ($haveDpapi -and -not (Ask-YesNo "Saved worker credentials found. Replace them?" $false)) {
  Write-Ok "Keeping saved (DPAPI-encrypted) credentials."
} elseif ($NonInteractive) {
  Write-Fail "No credentials found. Run without -NonInteractive to enter them."
  exit 1
} else {
  Write-Host "  Paste the values from your RevenueOS deployment (the same values used by the web app)."
  Write-Host "  Supabase: Project Settings > Database > Connection string (URI, session pooler)."
  Write-Host "  Input is hidden and stored encrypted for your Windows user only."
  $secrets = [ordered]@{}
  $db = Read-Host "  DATABASE_URL" -AsSecureString
  $key = Read-Host "  APP_ENCRYPTION_KEY" -AsSecureString
  $secrets["DATABASE_URL"] = Protect-Value $db
  $secrets["APP_ENCRYPTION_KEY"] = Protect-Value $key
  if (Ask-YesNo "Does your deployment use Supabase Storage (cloud)?" $true) {
    $srk = Read-Host "  SUPABASE_SERVICE_ROLE_KEY" -AsSecureString
    $secrets["SUPABASE_SERVICE_ROLE_KEY"] = Protect-Value $srk
    $supabaseUrl = Read-Host "  SUPABASE_URL (https://xxxx.supabase.co)"
    $appUrl = Read-Host "  Dashboard URL (e.g. https://revenueos.vercel.app)"
    $lines = @(
      "# Non-secret worker settings (secrets live in %APPDATA%\RevenueOS\worker.secrets.dpapi)",
      "STORAGE_DRIVER=supabase",
      "SUPABASE_URL=$($supabaseUrl.Trim())",
      "APP_URL=$($appUrl.Trim())"
    )
    Set-Content -LiteralPath $EnvWorkerFile -Value $lines -Encoding UTF8
    Write-Ok "Saved non-secret settings to .env.worker"
  }
  ($secrets | ConvertTo-Json) | Set-Content -LiteralPath $SecretsFile -Encoding UTF8
  Write-Ok "Credentials saved encrypted (DPAPI) to $SecretsFile"
}

# ---------------------------------------------------------------- 4. Check
Write-Step "Running the dependency check (includes a short test render)"
$env:REVENUEOS_SETUP = "1"
& (Join-Path $PSScriptRoot "start-worker.ps1") -CheckOnly
$checkExit = $LASTEXITCODE
if ($checkExit -ne 0) {
  Write-Fail "Some checks failed. Fix the items marked above and run setup again."
  exit $checkExit
}

# ---------------------------------------------------------------- 5. Optional conveniences
Write-Step "Optional"
if (Ask-YesNo "Create a 'RevenueOS Worker' shortcut on the Desktop?" $true) {
  $shell = New-Object -ComObject WScript.Shell
  $lnk = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "RevenueOS Worker.lnk"))
  $lnk.TargetPath = Join-Path $RepoRoot "start-worker.bat"
  $lnk.WorkingDirectory = $RepoRoot
  $lnk.Description = "Start the RevenueOS local worker"
  $lnk.Save()
  Write-Ok "Desktop shortcut created"
}
Write-Host "  Start with Windows is OFF. You can enable it later in the worker panel > Settings"
Write-Host "  (it adds a visible entry you can remove in Task Manager > Startup apps)."
if (Ask-YesNo "Enable start with Windows now?" $false) {
  $cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start-worker.ps1')`" -Hidden"
  & reg.exe add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v RevenueOSWorker /t REG_SZ /d $cmd /f | Out-Null
  Write-Ok "Start with Windows enabled (remove anytime in the panel or Task Manager)"
}

Write-Host ""
Write-Host "Setup complete. Start the worker with start-worker.bat (or: pnpm worker)." -ForegroundColor Green
Write-Host "The local panel opens at http://127.0.0.1:4417"
