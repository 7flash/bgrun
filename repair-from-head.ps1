$ErrorActionPreference = "Stop"

if (-not (Test-Path ".git")) {
  throw "Run this from the bgrun repository root."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path (Get-Location) ".bgrun-repair-backup-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$paths = @(
  "README.md",
  "SKILL.md",
  "package.json",
  "src/api.ts",
  "src/resource-monitor.ts",
  "src/process-snapshot.test.ts",
  "src/index.ts",
  "src/server.ts",
  "src/process-snapshot.ts",
  "src/db.ts",
  "src/commands/run.ts",
  "src/commands/details.ts",
  "src/commands/top.ts",
  "src/commands/list.ts",
  "src/commands/list.test.ts",
  "src/watcher.ts",
  "src/platform.ts",
  "dashboard/lib/process-snapshot.ts",
  "dashboard/app/api/processes/[name]/route.ts",
  "dashboard/app/api/version/route.ts",
  "dashboard/app/api/restart/[name]/route.ts",
  "dashboard/app/api/debug/route.ts",
  "dashboard/app/api/stop/[name]/route.ts",
  "dashboard/app/api/start/route.ts",
  "tests/helpers/control-runtime.mjs",
  "CHANGED_FILES.txt",
  "DELETE_FILES.txt",
  "src/observability.ts",
  "src/observability.test.ts",
  "dashboard/lib/observability.ts"
)

foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    $destination = Join-Path $backupRoot $path
    $parent = Split-Path -Parent $destination
    if ($parent) {
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $path -Destination $destination -Force -Recurse
  }
}

$trackedPaths = @{}
$headFiles = & git ls-tree -r --name-only HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Could not read files from Git HEAD."
}
foreach ($headPath in $headFiles) {
  $trackedPaths[$headPath] = $true
}

foreach ($path in $paths) {
  if ($trackedPaths.ContainsKey($path)) {
    & git restore --source=HEAD --worktree -- $path
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to restore $path from HEAD."
    }
  } elseif (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force -Recurse
  }
}

Write-Host "Restored files touched by the bad bgrun patch."
Write-Host "Backup: $backupRoot"
Write-Host ""
Write-Host "Current status:"
& git status --short
if ($LASTEXITCODE -ne 0) {
  throw "git status failed."
}

Write-Host ""
Write-Host "Running build..."
& bun run build
if ($LASTEXITCODE -ne 0) {
  throw "bun run build failed after rollback. Backup is at $backupRoot"
}

Write-Host ""
Write-Host "Build passed."
Write-Host "Backup: $backupRoot"
