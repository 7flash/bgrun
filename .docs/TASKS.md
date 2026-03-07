# bgrun — Tasks

## 🔴 Priority: Fix
- [x] ~~**Dashboard [object Object] rendering**~~ — ✅ DONE. Process table rendered `[object Object]` instead of rows. Triple-layered root cause: (1) duplicate `@jsxImportSource` pragma in docblock overrode real pragma with `resolves/jsx-dev-runtime`, (2) VDOM `render()` incompatible with dashboard's DOM manipulation (cleared `<thead>` when rendering `<tbody>`), (3) no initial `loadProcesses()` — relied solely on SSE for first render. Fixed by reverting to jsx-dom runtime + `replaceChildren()` + adding initial REST fetch.
- [x] ~~**Standalone guard process**~~ — ✅ DONE. `bgrun --guard` spawns an independent `bgr-guard` process that monitors ALL guarded processes (BGR_KEEP_ALIVE=true) AND the dashboard itself. If the dashboard dies, the guard restarts it — solving the critical issue where the built-in guard (running inside the dashboard) would die with it, leaving all processes unprotected. Implementation: `src/guard.ts` with per-process error isolation, exponential backoff after 5 rapid restarts, 2-minute stability window for counter reset. CLI: `--guard` (spawns managed process), `--_guard-loop` (internal loop).
- [x] ~~**bgr_list.json in git**~~ — ✅ DONE. `bgr_list.json` (CLI output containing env vars) was committed to repo. Fix: added to `.gitignore`. Keys already rotated so old history is fine.

## 🟡 Priority: Improve
- [x] ~~**Dashboard SSE stability**~~ — ✅ DONE. Server: added 15s periodic keepalive comments to prevent proxy/browser timeouts. Client: exponential backoff reconnections (2s→30s max), visibility-based SSE pausing (disconnect on tab hide, reconnect on focus), backoff reset on successful message.
- [x] ~~**Publish melina 2.3.7**~~ — ✅ DONE. Null guards added to render.ts (applyProps/patchProps/mountVNode). Published to npm, pushed to GitHub.
- [x] ~~**Dashboard log viewer reconciliation**~~ — ✅ DONE. Replaced the removed keyed reconciler with full virtual scrolling. Below 200 lines: direct DOM render (zero overhead). Above 200 lines: sentinel spacer virtual scrolling with rAF-throttled scroll handler — only ~50 visible lines rendered regardless of total log size. Filtered indices cached for search. Line count shows "(virtual)" indicator when engaged.
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

## 🟡 Priority: Improve
- [x] ~~**Dashboard process search persistence**~~ — ✅ DONE. Debounced 150ms input, DOM-to-variable sync on every render, keyboard focus-ring preserved across SSE rebuilds, result count badge (N/M) in search bar.
- [x] ~~**Log line height calibration**~~ — ✅ DONE. Auto-measures actual `.log-line` height from DOM on first render via `calibrateLogLineHeight()` + rAF. Replaces hardcoded 22px with real measurement for pixel-perfect virtual scroll spacers.
- [x] ~~**Dashboard keyboard shortcuts**~~ — ✅ DONE. Arrow ↑/↓ (or j/k) to navigate process rows with purple focus ring. Enter=open drawer, R=restart, S=stop, G=guard toggle, D=delete, N=new process, ?=help overlay. Glassmorphism shortcuts panel with 2-column grid. `?` button in toolbar for discoverability. All shortcuts suppressed in text inputs.

## 📝 Architecture Notes
- **Dashboard**: `bgrun --dashboard` (Port 3000 or `--port N`)
- **Client**: `dashboard/app/page.client.tsx` — uses **jsx-dom** runtime (NOT VDOM). JSX creates real DOM elements.
- **Guard**: `bgrun --guard` (standalone process, monitors dashboard + guarded processes)
- **Guard internals**: `src/guard.ts` — standalone loop, `src/server.ts` — built-in fallback
- **Guard skip list**: `bgr-dashboard` and `bgr-guard` skip themselves in both guard implementations
- **DB**: `~/.bgr/bgr_v2.sqlite` (sqlite-zod-orm)

## ⚠️ Gotchas
- **Never use `@jsxImportSource` as text inside ANY `/** */` comment block** — Bun parses it as a pragma from any JSDoc comment, not just the first one!
- **Melina `render()` clears container children** — `render(vnode, container)` removes all children before mounting. Don't render into `<table>` if you want to keep `<thead>`.
- **Build plugin mappings**: `react/jsx-runtime` → `jsx-dom.ts`, `melina/client/jsx-*-runtime` → VDOM, `melina/client` → barrel. `melina/client/render` has NO mapping — don't import it directly in client scripts.
