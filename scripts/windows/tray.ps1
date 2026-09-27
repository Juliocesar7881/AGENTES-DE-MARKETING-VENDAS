<#
.SYNOPSIS
  Notification-area (tray) icon for the RevenueOS worker. Started by the worker
  itself on Windows; exits when the worker exits. Uses only built-in Windows
  components (WinForms) and the worker's local panel API.
#>
param(
  [Parameter(Mandatory = $true)][string]$RuntimeFile,
  [Parameter(Mandatory = $true)][int]$WorkerPid
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-Runtime {
  try { return Get-Content -LiteralPath $RuntimeFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Invoke-Worker([string]$Method, [string]$Path) {
  $rt = Get-Runtime
  if (-not $rt) { return $null }
  try {
    return Invoke-RestMethod -Method $Method -Uri ($rt.url + $Path) -Headers @{ "x-worker-token" = $rt.token } -ContentType "application/json" -Body $(if ($Method -eq "POST") { "{}" } else { $null }) -TimeoutSec 5
  } catch { return $null }
}

function New-DotIcon([System.Drawing.Color]$Color) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 124, 92, 255))
  $g.FillEllipse($brush, 0, 0, 15, 15)
  $dot = New-Object System.Drawing.SolidBrush $Color
  $g.FillEllipse($dot, 9, 9, 6, 6)
  $g.Dispose()
  return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$iconOnline = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 34, 197, 94))
$iconPaused = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 245, 158, 11))
$iconOffline = New-DotIcon ([System.Drawing.Color]::FromArgb(255, 239, 68, 68))

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $iconOnline
$tray.Text = "RevenueOS Worker"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = $menu.Items.Add("RevenueOS Worker")
$itemStatus.Enabled = $false
[void]$menu.Items.Add("-")
$itemPanel = $menu.Items.Add("Open worker panel")
$itemDashboard = $menu.Items.Add("Open Dashboard")
$itemFolder = $menu.Items.Add("Open Render Folder")
[void]$menu.Items.Add("-")
$itemPause = $menu.Items.Add("Pause")
$itemResume = $menu.Items.Add("Resume")
[void]$menu.Items.Add("-")
$itemLogs = $menu.Items.Add("Logs")
$itemQuit = $menu.Items.Add("Quit worker")
$tray.ContextMenuStrip = $menu

$openPanel = { $rt = Get-Runtime; if ($rt) { Start-Process $rt.url } }
$itemPanel.add_Click($openPanel)
$itemLogs.add_Click($openPanel)
$tray.add_DoubleClick($openPanel)
$itemDashboard.add_Click({ [void](Invoke-Worker "POST" "/api/open-dashboard") })
$itemFolder.add_Click({ [void](Invoke-Worker "POST" "/api/open-folder") })
$itemPause.add_Click({ [void](Invoke-Worker "POST" "/api/pause") })
$itemResume.add_Click({ [void](Invoke-Worker "POST" "/api/resume") })
$itemQuit.add_Click({
  $r = [System.Windows.Forms.MessageBox]::Show("Quit the RevenueOS worker? Queued jobs wait until it starts again.", "RevenueOS", "YesNo", "Question")
  if ($r -eq "Yes") { [void](Invoke-Worker "POST" "/api/shutdown") }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  if (-not (Get-Process -Id $WorkerPid -ErrorAction SilentlyContinue)) {
    $tray.Visible = $false
    $tray.Dispose()
    [System.Windows.Forms.Application]::Exit()
    return
  }
  $s = Invoke-Worker "GET" "/api/status"
  if (-not $s) {
    $tray.Icon = $iconOffline
    $tray.Text = "RevenueOS Worker - not responding"
    return
  }
  $state = "Online"
  $tray.Icon = $iconOnline
  if (-not $s.databaseOk) { $state = "Offline (no database)"; $tray.Icon = $iconOffline }
  elseif ($s.paused) { $state = "Paused"; $tray.Icon = $iconPaused }
  $text = "RevenueOS - $state - $($s.pending) pending - $($s.renderedToday) today"
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $tray.Text = $text
  $itemStatus.Text = "$state | rendering $($s.rendering) | pending $($s.pending) | today $($s.renderedToday)"
  $itemPause.Enabled = -not $s.paused
  $itemResume.Enabled = [bool]$s.paused
})
$timer.Start()

[System.Windows.Forms.Application]::Run()
