# bgrun — Tasks

## 🔴 Priority: Fix
- [x] ~~**Standalone guard process**~~ — ✅ DONE. `bgrun --guard` spawns an independent `bgr-guard` process that monitors ALL guarded processes (BGR_KEEP_ALIVE=true) AND the dashboard itself. If the dashboard dies, the guard restarts it — solving the critical issue where the built-in guard (running inside the dashboard) would die with it, leaving all processes unprotected. Implementation: `src/guard.ts` with per-process error isolation, exponential backoff after 5 rapid restarts, 2-minute stability window for counter reset. CLI: `--guard` (spawns managed process), `--_guard-loop` (internal loop).
- [x] ~~**bgr_list.json in git**~~ — ✅ DONE. `bgr_list.json` (CLI output containing env vars) was committed to repo. Fix: added to `.gitignore`. Keys already rotated so old history is fine.

## 🟡 Priority: Improve
- [x] ~~**Guard dashboard UI**~~ — ✅ DONE. Added guard sentinel pill to toolbar showing standalone bgr-guard process status (green pulsing dot when running, red when stopped, gray when absent). Shows restart count. CSS: `.guard-sentinel-pill`, `.guard-sentinel-dot`.
- [x] ~~**Log rotation**~~ — ✅ DONE. `src/log-rotation.ts` — size-based rotation (10MB max, keeps last 5000 lines), periodic check every 60s, auto-starts with dashboard. API: `GET /api/logs/rotate` (sizes), `POST /api/logs/rotate` (trigger). Rotation header preserved in file for auditability.
- [x] ~~**Process dependency graph**~~ — ✅ DONE. `src/deps.ts` — adjacency list graph with Kahn's topological sort, cycle detection, and unmet dependency checking. Dependencies stored in `BGR_DEPENDS_ON=name1,name2` env var. Auto-start: `run.ts` checks and starts unmet deps before launching requested process. API: `GET /api/deps` (graph+order), `POST /api/deps` (set deps for a process).
- [x] ~~**Dashboard stats grid: 6th card**~~ — ✅ DONE. "Guard Restarts" card showing total guard restarts aggregated across all processes. Warning-orange accent color, 6-column grid layout (3-column on mobile). Wired to `guardRestarts` field from API.

## ✅ Completed
- [x] ~~**Dashboard guard toggle UI**~~ — ✅ DONE. Shield icon button next to each process name in the table row. Glows teal (#14b8a6) when guarded, faded grey when not. Clicking it calls `POST /api/guard` to toggle `BGR_KEEP_ALIVE=true` in the process env. Guard toggle also available in right-click context menu and mobile card action buttons.
- [x] ~~**Dashboard guard status display**~~ — ✅ DONE. Guarded state shown via shield icon glow in table rows, 🛡️ badge in mobile cards, "Guarded" stat card in stats grid showing count of guarded processes. `isGuarded()` helper parses both JSON env and comma-separated env strings.
- [x] ~~**Guard indicator in drawer meta panel**~~ — ✅ DONE. Added guard toggle row to the Info section of the process detail drawer.
- [x] ~~**Bulk guard operations**~~ — ✅ DONE. "Guard All" / "Unguard All" toggle button in toolbar.
- [x] ~~**Guard auto-restart counter**~~ — ✅ DONE. In-memory counter on `server.ts` (via `globalThis`) tracks guard restarts per process.
- [x] ~~**Fix `/api/guard` 500 in binary mode**~~ — ✅ DONE. Fixed import path.
- [x] ~~**Built-in process guard**~~ — ✅ DONE (v3.10.2). Guard loop runs inside dashboard server, checks every 30s.
- [x] ~~**Guard scope**~~ — ✅ DONE (v3.10.2). Only processes with `BGR_KEEP_ALIVE=true`.
- [x] ~~**updateProcessEnv()**~~ — ✅ DONE. Added to `db.ts`.
- [x] ~~**Live log streaming**~~ — ✅ Skipped. CLI `--logs` sufficient.
- [x] ~~**Resource charts**~~ — ✅ DONE. SVG MiniSparklines, 5-minute rolling window.
- [x] ~~**Dashboard port-reclaim**~~ — ✅ DONE. Auto-kills port occupant.
- [x] ~~**Mobile responsive tables**~~ — ✅ DONE. 3-column grid layout for action buttons.
- [x] ~~**Crash loop backoff**~~ — ✅ DONE. Exponential backoff after 5 rapid crashes.

## 📝 Architecture Notes
- **Dashboard**: `bgrun --dashboard` (Port 3000 or `--port N`)
- **Guard**: `bgrun --guard` (standalone process, monitors dashboard + guarded processes)
- **Guard internals**: `src/guard.ts` — standalone loop, `src/server.ts` — built-in fallback
- **Guard skip list**: `bgr-dashboard` and `bgr-guard` skip themselves in both guard implementations
- **DB**: `~/.bgr/bgr_v2.sqlite` (sqlite-zod-orm)
