# bgrun — Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Dashboard unreachable after restart (zombie port)**~~ — ✅ DONE. Dead PIDs leave CloseWait sockets on port 3000 (Windows kernel issue). Added `cleanupPort()` that detects zombie PIDs and falls back to port+1 (3001).
- [x] ~~**Guard not auto-enabled for new processes**~~ — ✅ DONE. `run.ts` now defaults `BGR_KEEP_ALIVE=true` for all new processes (CLI and dashboard). Only skipped if explicitly set to `false` in env.
- [x] ~~**CLI/dashboard status mismatch for detached Windows processes**~~ — ✅ DONE. `isProcessRunning()` now falls back to `Get-Process` when `process.kill(pid, 0)` returns a false negative under Git Bash/MSYS or detached wrapper scenarios, so CLI, guard, and dashboard agree on liveness.

## 🟡 Priority: Improve
- [x] ~~**Dashboard port should be sticky**~~ — ✅ DONE. Added `startStickyPortChecker()` in server.ts that checks every 60s if original port is available.
- [x] ~~**Guard restart logging**~~ — ✅ DONE. Added `/api/guard-events` endpoint and guard activity panel in dashboard UI.

## ✅ Completed This Session
- Added sticky port checker that periodically re-checks for original port availability
- Added guard activity feed showing real-time restart events in dashboard

## 🟢 Priority: Features (Future)
- [ ] **Process groups** — Allow grouping processes by directory/config
- [x] ~~**Deploy all**~~ — ✅ DONE. Added shared `src/deploy.ts`, single-process deploy refactor, and `/api/deploy-all` for git pull + restart across all deployable processes or the selected group from the dashboard toolbar.
- [ ] **Process templates** — Save/load process configurations
- [x] ~~**Port conflict detection**~~ — Added getPortInfo() to platform.ts, added to API (in progress - Melina caching issues)
- [ ] **Process history** — Track start/stop/restart history with timestamps
- [ ] **Dashboard UI improvements** — Show port conflict warning before starting
- [ ] **Better error messages** — Improve bgrun CLI feedback for common issues
- [ ] **Deploy output drill-down** — Show per-process deploy results/logs in a modal instead of only toast summaries
- [ ] **Safer package-manager detection** — Use lockfiles to choose bun/npm/pnpm/yarn during deploy instead of always `bun install`

## 📝 Architecture Notes
- **Version**: v3.12.0
- **Dashboard port**: 3000 (fallback to 3001 if zombie socket detected)
- **Guard interval**: 30 seconds
- **Guard opt-in**: `BGR_KEEP_ALIVE=true` in process env
- **DB**: `~/.bgr/bgr_v2.sqlite` (sqlite-zod-orm)
- **Dashboard**: Melina.js (file-based routing under `dashboard/app/`)
- **CLI**: `bgrun` (global, built via `src/build.ts`)
