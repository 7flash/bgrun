# bgrun — Tasks & Ideas

## 🟡 Priority: Improve
- [x] ~~**Dashboard detachment on Windows**~~ — ✅ DONE. Dashboard spawn now uses `detached: true` + `stdio: "ignore"` to break out of the parent terminal's Job Object. PID detection via `findPidByPort` since cmd.exe wrapper exits immediately in detached mode. Guard spawn also detached with command-line PID fallback.
- [x] ~~**Dashboard log viewing when detached**~~ — ✅ DONE. Detached processes (dashboard, guard) now redirect `console.log`/`console.error` to their log files via `redirectConsoleToFiles()`. Parent passes paths via `BGR_STDOUT`/`BGR_STDERR` env vars. Output is timestamped with ANSI codes stripped. `bgrun bgr-dashboard --logs` now shows real output.

## 🟢 Priority: Features
- [x] ~~**Process health metrics in dashboard**~~ — ✅ ALREADY DONE. `MiniSparkline` SVG component renders CPU/memory trends (up to 60 data points = 5 min at 5s polling). Displayed in both `ProcessRow` table and `ProcessCard` mobile views. API (`/api/processes`) collects `memoryHistory[]` and `cpuHistory[]` with per-process tracking via `__bgrResourceHistory` global Map. Windows CPU uses delta-time calculation; Unix uses `ps` percentage directly.
- [x] ~~**Webhook notifications**~~ — ✅ DONE. Guard fires HTTP POST to `BGR_WEBHOOK_URL` on crash/restart/restart_failed events. Payload includes process name, PID, restart count, backoff, timestamp. Optional `BGR_WEBHOOK_SECRET` enables HMAC-SHA256 signature in `X-BGR-Signature` header (GitHub-style). 5s timeout, non-blocking. Shown in guard startup banner.
- [x] ~~**Auto-enable guard for new processes**~~ — ✅ DONE. New processes now default to `BGR_KEEP_ALIVE=true` unless explicitly disabled. Agent auto-restarts processes on crash.

## 🚧 New Tasks
- [x] ~~**Process groups**~~ — ✅ DONE. Added group filter dropdown in toolbar, group badge on process cards, filtering by group in renderFilteredProcesses(), and CSS styles for group-badge and group-filter dropdown.
- [x] ~~**Process templates**~~ — ✅ DONE. Added template schema in db.ts, `/api/templates` CRUD endpoints, Templates button in toolbar, modal UI with form fields (name, command, directory, group, env), saved template list with Use/Delete actions, and "Use" fills New Process form.
- [x] ~~**Process history**~~ — ✅ DONE. Added history schema and functions in db.ts, `/api/history` endpoint, History button in toolbar, modal UI with process/event filters, and history entries recorded on start/stop/restart/guard events. Shows timestamp, process name, event type, and PID.
- [ ] **Deploy all processes** — One-click deploy: git pull + restart for all processes
- [ ] **Dashboard UI polish** — Theme toggle, process uptime stats, better mobile layout
- [ ] **Sticky port allocation** — Auto-assign next available port when starting new processes

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
