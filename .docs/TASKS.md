# bgrun — Tasks & Ideas

## 🟢 Priority: Features
- [x] ~~**Process dependency graph**~~ — ✅ DONE. Added `dependency` table to SQLite schema with cycle detection (DFS), topological start-order (Kahn's algorithm), and full CRUD API at `/api/dependencies`. Dashboard modal with interactive SVG DAG visualization (layered layout, hover-highlighting, running status dots), dependency list with inline remove, and recommended start order badges. 7 new tests (39 total, 68 expect() calls).
- [x] ~~**Log export**~~ — ✅ DONE. Added CSV/JSON export for History entries plus text/JSON/CSV export for process logs through the dashboard API, and wired export buttons into the History modal and log drawer.
- [ ] **Add log export coverage** — Add focused API tests for `/api/history?format=csv` and `/api/logs/:name?format=text|csv|json` so export behavior stays stable.
- [ ] **Process resource alerts** — Notify when CPU/memory exceeds configurable thresholds
- [ ] **Config hot-reload** — Watch `.config.toml` for changes and auto-restart the process
- [ ] **Multi-node support** — Manage processes across multiple machines from one dashboard

## 🟡 Priority: Improve
- [ ] **Light theme refinement** — Audit all UI components for contrast and readability in light mode
- [ ] **Dashboard performance** — Profile and optimize rendering with 50+ processes
- [ ] **CLI process search** — Add `bgrun list --filter running` and `bgrun list --group mygroup` to CLI
- [ ] **Deploy rollback** — Store previous git commit hash before deploy, add one-click rollback

## 🔴 Priority: Fix
- [x] ~~**Fix Unix no-port restart false-positive listener detection**~~ — ✅ DONE. Updated the Unix `getProcessPorts(pid)` lsof fallback to use `lsof -Pan -p <pid> -iTCP -sTCP:LISTEN` so worker processes without configured ports no longer report unrelated listeners during restart checks.
- [x] ~~**Add Unix process-port regression coverage**~~ — ✅ DONE. Extracted Unix `lsof` LISTEN parsing into a dedicated helper and added focused tests covering true LISTEN sockets, broad `lsof` output with ESTABLISHED noise, and no-port worker output.
- [x] ~~**Normalize npm publish metadata warnings**~~ — ✅ DONE. Updated `package.json` metadata via `npm pkg fix` (`bin` path + `repository.url`) and verified with `npm publish --dry-run` that publishes are warning-free.
- [x] ~~**Trim published package contents further**~~ — ✅ DONE. Tightened `package.json` `files` to ship only the runtime `src/` files plus required assets, which removes `src/bgrun.test.ts`, `src/index_copy.ts`, and other low-value publish artifacts from the tarball.
- [ ] **Decide whether runtime `src/` files should keep shipping at all** — The package still intentionally includes non-test `src/` files for API/import compatibility; decide whether to preserve that contract or move consumers fully onto built `dist/` entrypoints.

## 📝 Architecture Notes
- **Package**: `bgrun` on npm
- **DB**: `~/.bgr/bgrun.sqlite` (sqlite-zod-orm)
- **Dashboard**: Melina.js on port 3000 (file-based routing in `dashboard/app/`)
- **Guard**: Built into dashboard — monitors `BGR_KEEP_ALIVE=true` processes
- **Tests**: 32 passing, 59 expect() calls — `bun test`
- **Build**: `bun run build` → `dist/index.js`
- **Dev**: `bun run src/index.ts --help`

## ⚠️ Security Reminders
- Dashboard has no authentication — localhost only
