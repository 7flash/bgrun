# bgrun-startup.ps1 — Persistent bgr-dashboard launcher
# Ensures the bgrun dashboard survives terminal closures.
# Individual services (geeksy, mm-dash, galaxy-canvas, etc.) are managed
# by bgr-guard INSIDE the dashboard — this script only keeps the dashboard alive.
#
# Usage:
#   .\bgrun-startup.ps1                  # Start bgr-dashboard
#   .\bgrun-startup.ps1 -Install         # Register as logon scheduled task
#   .\bgrun-startup.ps1 -Uninstall       # Remove scheduled task
#   .\bgrun-startup.ps1 -Guard           # Run guard loop (auto-restart dashboard)

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Guard
)

$TaskName = "bgrun-persistence"
$ScriptPath = $MyInvocation.MyCommand.Path

# ─── Install as Scheduled Task ────────────────────────────
if ($Install) {
    $action = New-ScheduledTaskAction `
        -Execute "pwsh.exe" `
        -Argument "-WindowStyle Hidden -NonInteractive -File `"$ScriptPath`" -Guard"
    
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -RestartCount 3 `
        -ExecutionTimeLimit (New-TimeSpan -Hours 0)  # No time limit

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Keeps bgr-dashboard alive across terminal closures. Dashboard's own bgr-guard handles individual services." `
        -Force

    Write-Host "✅ Scheduled task '$TaskName' registered for user $env:USERNAME"
    Write-Host "   Runs at logon — keeps bgr-dashboard alive"
    Write-Host "   To start immediately: schtasks /run /tn '$TaskName'"
    exit 0
}

# ─── Uninstall ────────────────────────────────────────────
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "🗑️  Scheduled task '$TaskName' removed"
    exit 0
}

# ─── Guard mode: keep bgr-dashboard alive ─────────────────
if ($Guard) {
    Write-Host "🛡️  bgrun dashboard guard started at $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    
    while ($true) {
        try {
            $dashboard = & bgrun --json 2>$null | ConvertFrom-Json | Where-Object { $_.name -eq 'bgr-dashboard' }
            
            if (-not $dashboard -or $dashboard.status -ne "running") {
                Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ⚠️  bgr-dashboard is DOWN — restarting..."
                & bgrun --restart bgr-dashboard --force 2>$null
                Start-Sleep -Seconds 3
            }
        } catch {
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] ❌ Guard check failed: $_"
        }
        
        Start-Sleep -Seconds 60
    }
    exit 0
}

# ─── Default: one-time start ──────────────────────────────
Write-Host "🚀 Starting bgr-dashboard..."
$dashboard = & bgrun --json 2>$null | ConvertFrom-Json | Where-Object { $_.name -eq 'bgr-dashboard' }
if ($dashboard -and $dashboard.status -eq "running") {
    Write-Host "  ✓ bgr-dashboard already running (PID $($dashboard.pid))"
} else {
    & bgrun --restart bgr-dashboard --force 2>$null
    Start-Sleep -Seconds 2
    Write-Host "  ✓ bgr-dashboard started"
}
Write-Host "`n✅ Done. Dashboard's bgr-guard handles individual services."
Write-Host "   💡 Run with -Install to persist across terminal closures"

