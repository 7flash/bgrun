# bgrun — Tasks & Ideas

## 🟢 Priority: Features
- [x] ~~**Process dependency graph**~~ — ✅ DONE. Added `dependency` table to SQLite schema with cycle detection (DFS), topological start-order (Kahn's algorithm), and full CRUD API at `/api/dependencies`. Dashboard modal with interactive SVG DAG visualization (layered layout, hover-highlighting, running status dots), dependency list with inline remove, and recommended start order badges. 7 new tests (39 total, 68 expect() calls).
- [x] ~~**Log export**~~ — ✅ DONE. Added CSV/JSON export for History entries plus text/JSON/CSV export for process logs through the dashboard API, and wired export buttons into the History modal and log drawer.
- [x] ~~**Add log export coverage**~~ — ✅ DONE. Added focused API tests in `tests/export-api.test.ts` covering `/api/history?format=csv` plus `/api/logs/:name?format=text|csv|json`, including filtered history export and download headers.
- [x] ~~**Stop test DB auto-migrating from live legacy DB**~~ — ✅ DONE. Added `BGRUN_DISABLE_LEGACY_MIGRATION` support in `src/db.ts`, turned it on for tests, and added `tests/db-migration.test.ts` to verify both the disabled and default migration paths.
- [x] ~~**Silence migration log noise in migration tests**~~ — ✅ DONE. Wrapped the default migration-path import in a temporary `console.log` stub inside `tests/db-migration.test.ts`, so the regression coverage stays intact without spamming the test output.
- [x] ~~**Decide whether runtime `src/` files should keep shipping at all**~~ — ✅ DONE. Chose to keep publishing the runtime `src/` subset for now because the Bun programmatic API still resolves through `src/api.ts`; documented the decision in ADR-002 and clarified it in the README.
- [x] ~~**Design a `dist/api.js` migration path**~~ — ✅ DONE. Documented the staged migration plan in ADR-003: first emit a built API artifact, then run a dual-entry compatibility phase, then flip exports, then remove runtime `src/` publishing.
- [x] ~~**Build `dist/api.js` alongside the CLI**~~ — ✅ DONE. Extended `src/build.ts` to emit both `dist/index.js` and `dist/api.js` while leaving package exports unchanged for compatibility.
- [x] ~~**Add built-API compatibility smoke tests**~~ — ✅ DONE. Added `tests/dist-api.test.ts` to build the package, import both `src/api.ts` and `dist/api.js`, compare the named/default export surfaces, and verify core utility/db metadata behavior matches.
- [x] ~~**Flip `main`/`exports` to `dist/api.js` behind a compatibility release**~~ — ✅ DONE. Switched the package entrypoints from `src/api.ts` to `dist/api.js`, while still temporarily publishing the runtime `src/` subset during the migration window.
- [x] ~~**Migrate dashboard API routes off `src/*` imports**~~ — ✅ DONE. Added `dashboard/lib/runtime.ts` as a built-artifact compatibility layer, emitted the extra `dist` runtime modules needed by the dashboard, and rewired all dashboard API routes off direct `src/*` imports.
- [ ] **Stop publishing runtime `src/` files after dashboard migration** — The package now has built entrypoints plus dashboard compatibility through `dist/*`, so the remaining cleanup step is removing temporary runtime `src/` publishing from the package.
- [ ] **Add dashboard route smoke coverage through the new compatibility layer** — The route migration works in the full suite, but add a focused smoke test that directly validates the `dashboard/lib/runtime.ts` layer and a couple of representative route imports.
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

## 📝 Architecture Notes
- **Package**: `bgrun` on npm
- **DB**: `~/.bgr/bgrun.sqlite` (sqlite-zod-orm)
- **Dashboard**: Melina.js on port 3000 (file-based routing in `dashboard/app/`)
- **Dashboard runtime bridge**: `dashboard/lib/runtime.ts` now routes dashboard backend imports through built `dist/*` artifacts instead of direct `src/*` imports.
- **Guard**: Built into dashboard — monitors `BGR_KEEP_ALIVE=true` processes
- **Tests**: 32 passing, 59 expect() calls — `bun test`
- **Build**: `bun run build` → `dist/index.js` + `dist/api.js` + `dist/server.js` + `dist/deploy.js` + `dist/deps.js` + `dist/log-rotation.js`
- **Dev**: `bun run src/index.ts --help`

## ⚠️ Security Reminders
- Dashboard has no authentication — localhost only
