# bgrun — Tasks

## 🟢 Priority: Features
- [ ] **Dashboard guard toggle UI** — Add a shield icon toggle button on each process row in the dashboard. Clicking it calls `POST /api/guard` to toggle `BGR_KEEP_ALIVE=true` in the process env. Backend API already exists at `dashboard/app/api/guard/route.ts`. Shield icon should glow green when guarded, grey when not.
- [ ] **Dashboard guard status display** — Show guarded/unguarded state per process in the dashboard table. Parse `env` JSON and check for `BGR_KEEP_ALIVE=true`. Show "🛡️" badge or similar visual indicator.

## ✅ Completed
- [x] ~~**Built-in process guard**~~ — ✅ DONE (v3.10.2). Guard loop runs inside dashboard server, checks every 30s for dead processes with `BGR_KEEP_ALIVE=true`, auto-restarts them.
- [x] ~~**Guard scope**~~ — ✅ DONE (v3.10.2). Guard only restarts processes with `BGR_KEEP_ALIVE=true` in their env (not all processes). Per user feedback.
- [x] ~~**updateProcessEnv()**~~ — ✅ DONE. Added to `db.ts` for updating a process's env JSON by name.
