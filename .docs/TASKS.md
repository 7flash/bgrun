# bgrun — Tasks & Ideas

## 🟢 Priority: Features
- [x] ~~**Process dependency graph**~~ — ✅ DONE. Added `dependency` table to SQLite schema with cycle detection (DFS), topological start-order (Kahn's algorithm), and full CRUD API at `/api/dependencies`. Dashboard modal with interactive SVG DAG visualization (layered layout, hover-highlighting, running status dots), dependency list with inline remove, and recommended start order badges. 7 new tests (39 total, 68 expect() calls).
- [ ] **Log export** — Add CSV/JSON export for History entries and process logs
- [ ] **Process resource alerts** — Notify when CPU/memory exceeds configurable thresholds
- [ ] **Config hot-reload** — Watch `.config.toml` for changes and auto-restart the process
- [ ] **Multi-node support** — Manage processes across multiple machines from one dashboard

## 🟡 Priority: Improve
- [ ] **Light theme refinement** — Audit all UI components for contrast and readability in light mode
- [ ] **Dashboard performance** — Profile and optimize rendering with 50+ processes
- [ ] **CLI process search** — Add `bgrun list --filter running` and `bgrun list --group mygroup` to CLI
- [ ] **Deploy rollback** — Store previous git commit hash before deploy, add one-click rollback

## 🔴 Priority: Fix
- (none currently)

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
