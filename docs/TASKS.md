# bgrun — Tasks

## 🟢 Priority: Features
- [x] ~~**Dashboard guard toggle UI**~~ — ✅ DONE. Shield icon button next to each process name in the table row. Glows teal (#14b8a6) when guarded, faded grey when not. Clicking it calls `POST /api/guard` to toggle `BGR_KEEP_ALIVE=true` in the process env. Guard toggle also available in right-click context menu and mobile card action buttons.
- [x] ~~**Dashboard guard status display**~~ — ✅ DONE. Guarded state shown via shield icon glow in table rows, 🛡️ badge in mobile cards, "Guarded" stat card in stats grid showing count of guarded processes. `isGuarded()` helper parses both JSON env and comma-separated env strings.

## 🟡 Priority: Improve
- [x] ~~**Guard indicator in drawer meta panel**~~ — ✅ DONE. Added guard toggle row to the Info section of the process detail drawer. Shows shield icon + "Guard" label + toggle switch (track/thumb with teal glow animation). Calls `POST /api/guard` on toggle with optimistic UI update + rollback on failure. Full-width row spanning both meta grid columns with `guarded`/non-guarded CSS states. Note: `/api/guard` endpoint returns 500 in binary mode (pre-existing issue, also affects table guard buttons).
- [x] ~~**Bulk guard operations**~~ — ✅ DONE. "Guard All" / "Unguard All" toggle button in toolbar (between refresh and new process). Uses `POST /api/guard-all` batch endpoint that iterates all processes, skipping bgr-dashboard. Button label/style auto-switches based on guard state — teal when all guarded, red hover when clicking to unguard. Disables during operation. Toast shows count of affected processes.
- [x] ~~**Guard auto-restart counter**~~ — ✅ DONE. In-memory counter on `server.ts` (via `globalThis`) tracks guard restarts per process. Exposed as `guardRestarts` field in `/api/processes` response. Rendered in drawer info panel as an amber badge with "X auto-restarts this session" text — only visible when count > 0. Counter resets on dashboard restart (by design — tracks "this session" restarts).
- [x] ~~**Fix `/api/guard` 500 in binary mode**~~ — ✅ DONE. Root cause: import path `../../../src/db` in `dashboard/app/api/guard/route.ts` was one level too shallow — resolved to `dashboard/src/db` instead of project root `src/db`. Fixed to `../../../../src/db` to match other same-depth routes like `api/processes/route.ts`.

## ✅ Completed
- [x] ~~**Built-in process guard**~~ — ✅ DONE (v3.10.2). Guard loop runs inside dashboard server, checks every 30s for dead processes with `BGR_KEEP_ALIVE=true`, auto-restarts them.
- [x] ~~**Guard scope**~~ — ✅ DONE (v3.10.2). Guard only restarts processes with `BGR_KEEP_ALIVE=true` in their env (not all processes). Per user feedback.
- [x] ~~**updateProcessEnv()**~~ — ✅ DONE. Added to `db.ts` for updating a process's env JSON by name.

## 🟢 Priority: Features
- [x] ~~**Live log streaming**~~ — ✅ Skipped. `bgrun` CLI already has the `--logs` command and tail functionality so this is no longer a high priority for the web dashboard.
- [ ] **Resource charts** — Add CPU/Memory historical usage charts in the dashboard using small sparklines.

## 🟡 Priority: Improve
- [x] ~~**Mobile responsive tables**~~ — ✅ DONE. Fixed the issue where action buttons overflowed on mobile screens by updating `.card-actions` CSS to use a 3-column grid layout, ensuring buttons wrap gracefully without squashing.
- [x] ~~**Crash loop backoff**~~ — ✅ DONE. Add exponential backoff for the guard restarter if a process crashes immediately upon startup over 5 times.
