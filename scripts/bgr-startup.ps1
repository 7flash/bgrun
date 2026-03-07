# bgr-startup.ps1 — Auto-start bgrun guard on Windows login
# Ensures all guarded processes (and the dashboard itself) start on boot.
#
# Installation:
#   1. Run this script once with -Install flag:
#      powershell -ExecutionPolicy Bypass -File bgr-startup.ps1 -Install
#
#   2. Or manually create a Task Scheduler task:
#      - Trigger: At log on
#      - Action: powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\Code\bgr\scripts\bgr-startup.ps1"
#      - Run whether user is logged on or not: Yes
#
# Usage:
#   bgr-startup.ps1           # Start bgrun guard
#   bgr-startup.ps1 -Install  # Register Task Scheduler entry

param(
    [switch]$Install
)

$BunPath = "$env:USERPROFILE\.bun\bin\bun.exe"
$BgrunPath = "C:\Code\bgr"
$LogPath = "$env:USERPROFILE\.bgr\startup.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue
}

# Ensure .bgr directory exists
$bgrDir = "$env:USERPROFILE\.bgr"
if (-not (Test-Path $bgrDir)) {
    New-Item -ItemType Directory -Path $bgrDir -Force | Out-Null
}

if ($Install) {
    Write-Log "Installing bgrun auto-start task..."

    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        $scriptPath = Join-Path $BgrunPath "scripts\bgr-startup.ps1"
    }

    # Remove existing task if present
    $existingTask = Get-ScheduledTask -TaskName "bgrun-guard" -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName "bgrun-guard" -Confirm:$false
        Write-Log "Removed existing bgrun-guard task"
    }

    # Create the scheduled task
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`""

    $trigger = New-ScheduledTaskTrigger -AtLogon
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -RestartCount 3

    Register-ScheduledTask `
        -TaskName "bgrun-guard" `
        -Description "bgrun process manager — auto-starts all guarded processes on login" `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -RunLevel Highest `
        -Force

    Write-Log "✓ Task 'bgrun-guard' registered. Will start on next login."
    Write-Log "  Script: $scriptPath"
    exit 0
}

# ── Main: Start bgrun guard ─────────────────────────────────
Write-Log "bgrun startup initiated"

# Check bun exists
if (-not (Test-Path $BunPath)) {
    Write-Log "ERROR: bun not found at $BunPath"
    exit 1
}

# Check bgrun repo exists
if (-not (Test-Path "$BgrunPath\src\guard.ts")) {
    Write-Log "ERROR: bgrun not found at $BgrunPath"
    exit 1
}

# Start the dashboard first (guard needs it)
Write-Log "Starting bgrun dashboard..."
$dashboardProc = Start-Process -FilePath $BunPath `
    -ArgumentList "run", "$BgrunPath\src\index.ts", "--dashboard", "--port", "3000" `
    -WindowStyle Hidden `
    -PassThru `
    -WorkingDirectory $BgrunPath

Write-Log "Dashboard PID: $($dashboardProc.Id)"

# Wait for dashboard to be ready
Start-Sleep -Seconds 5

# Start the guard (watches dashboard + all guarded processes)
Write-Log "Starting bgrun guard..."
$guardProc = Start-Process -FilePath $BunPath `
    -ArgumentList "run", "$BgrunPath\src\index.ts", "--guard" `
    -WindowStyle Hidden `
    -PassThru `
    -WorkingDirectory $BgrunPath

Write-Log "Guard PID: $($guardProc.Id)"
Write-Log "✓ bgrun startup complete. Dashboard: $($dashboardProc.Id), Guard: $($guardProc.Id)"
