# bgrun — Tasks & Ideas

## 🟡 Priority: Improve
- [x] ~~**Dashboard detachment on Windows**~~ — ✅ DONE. Dashboard spawn now uses `detached: true` + `stdio: "ignore"` to break out of the parent terminal's Job Object. PID detection via `findPidByPort` since cmd.exe wrapper exits immediately in detached mode. Guard spawn also detached with command-line PID fallback.
- [x] ~~**Dashboard log viewing when detached**~~ — ✅ DONE. Detached processes (dashboard, guard) now redirect `console.log`/`console.error` to their log files via `redirectConsoleToFiles()`. Parent passes paths via `BGR_STDOUT`/`BGR_STDERR` env vars. Output is timestamped with ANSI codes stripped. `bgrun bgr-dashboard --logs` now shows real output.

## 🟢 Priority: Features
- [x] ~~**Process health metrics in dashboard**~~ — ✅ ALREADY DONE. `MiniSparkline` SVG component renders CPU/memory trends (up to 60 data points = 5 min at 5s polling). Displayed in both `ProcessRow` table and `ProcessCard` mobile views. API (`/api/processes`) collects `memoryHistory[]` and `cpuHistory[]` with per-process tracking via `__bgrResourceHistory` global Map. Windows CPU uses delta-time calculation; Unix uses `ps` percentage directly.
- [ ] **Webhook notifications** — Send HTTP webhook when a guarded process crashes or restarts.

## 📝 Architecture Notes
- **Package**: `bgrun` on npm
- **DB**: SQLite at `~/.bgr/bgr_v2.sqlite` (sqlite-zod-orm)
- **Dashboard**: Melina.js on port 3000 (file-based routing in `dashboard/app/`)
- **Guard**: Built into dashboard — monitors `BGR_KEEP_ALIVE=true` processes
- **Tests**: 22 passing, 45 expect() calls — `bun test`
- **Build**: `bun run build` → `dist/index.js`
- **Dev**: `bun run src/index.ts --help`

## ⚠️ Security Reminders
- Dashboard has no authentication — localhost only
