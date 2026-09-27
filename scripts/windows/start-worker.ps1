<#
.SYNOPSIS
  Starts the RevenueOS local worker.

.PARAMETER Hidden
  Run without a console window (used by "start with Windows"). A tray icon
  gives access to the panel, pause/resume and quit.

.PARAMETER CheckOnly
  Only run the dependency check and exit with its status.

.PARAMETER OpenPanel
  Open the local panel in the browser after starting.
#>
[CmdletBinding()]
param(
  [switch]$Hidden,
  [switch]$CheckOnly,
  [switch]$OpenPanel
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ConfigDir = Join-Path $env:APPDATA "RevenueOS"
$SecretsFile = Join-Path $ConfigDir "worker.secrets.dpapi"
$RuntimeFile = Join-Path $ConfigDir "worker.runtime.json"

# Already running? Open its panel instead of starting a second worker.
if (-not $CheckOnly -and (Test-Path $RuntimeFile)) {
  try {
    $rt = Get-Content -LiteralPath $RuntimeFile -Raw | ConvertFrom-Json
    $proc = Get-Process -Id ([int]$rt.pid) -ErrorAction SilentlyContinue
    if ($proc) {
      if (-not $Hidden) {
        Write-Host "RevenueOS worker is already running (PID $($rt.pid)). Opening its panel..."
        Start-Process $rt.url
      }
      exit 0
    }
  } catch { }
}

# Decrypt DPAPI-protected secrets into this process's environment only (never written to disk in plain text).
if (Test-Path $SecretsFile) {
  $data = Get-Content -LiteralPath $SecretsFile -Raw | ConvertFrom-Json
  foreach ($prop in $data.PSObject.Properties) {
    $secure = ConvertTo-SecureString -String $prop.Value
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    [Environment]::SetEnvironmentVariable($prop.Name, $plain, "Process")
  }
}

$tsx = Join-Path $RepoRoot "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsx)) {
  $tsx = Join-Path $RepoRoot "apps\worker\node_modules\tsx\dist\cli.mjs"
}
if (-not (Test-Path $tsx)) {
  Write-Host "Dependencies are missing. Run scripts\windows\setup-worker.ps1 first." -ForegroundColor Red
  exit 1
}

Set-Location $RepoRoot
if ($CheckOnly) {
  & node $tsx (Join-Path $RepoRoot "apps\worker\src\cli\check.ts")
  exit $LASTEXITCODE
}

$workerArgs = @($tsx, (Join-Path $RepoRoot "apps\worker\src\index.ts"))
if ($OpenPanel) { $workerArgs += "--open" }
if ($Hidden) {
  # Console output is not needed: the worker writes rotating logs to %APPDATA%\RevenueOS\logs.
  & node @workerArgs *> $null
} else {
  $Host.UI.RawUI.WindowTitle = "RevenueOS Worker"
  & node @workerArgs
}
exit $LASTEXITCODE
