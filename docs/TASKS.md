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
- [x] ~~**Windows detached-process liveness mismatch**~~ — ✅ DONE. Reproduced a CLI/dashboard disagreement for `bgr-guard`; fixed `isProcessRunning()` to fall back to `Get-Process` when signal-0 checks fail under Git Bash/MSYS or detached wrapper scenarios.
- [x] ~~**Deploy all processes**~~ — ✅ DONE. Added shared deploy helper in `src/deploy.ts`, refactored single deploy API to use it, and added `/api/deploy-all` plus a toolbar button that deploys either all deployable processes or the currently selected group.
- [ ] **Dashboard UI polish** — Theme toggle, process uptime stats, better mobile layout
- [ ] **Sticky port allocation** — Auto-assign next available port when starting new processes
- [ ] **Regression test for Windows liveness fallback** — Add coverage around detached/background processes so CLI and dashboard status stay consistent on Windows shells
- [x] ~~**Deploy result details UI**~~ — ✅ DONE. Bulk deploy now opens a results modal with per-process deployed/skipped/failed status plus expandable git/install output.
- [x] ~~**Package manager auto-detection for deploys**~~ — ✅ DONE. Deploy helper now inspects lockfiles and runs `bun install`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, or `npm ci` as appropriate.
- [x] ~~**Deploy retry actions in results modal**~~ — ✅ DONE. Failed/skipped entries in the deploy results modal can now be retried inline and update their own result card after completion.
- [x] ~~**Missing package-manager UX**~~ — ✅ DONE. Deploy helper now turns missing pnpm/yarn/npm/bun executables into clear install/PATH errors instead of generic command failures.
- [x] ~~**Bulk deploy progress UI**~~ — ✅ DONE. Bulk deploy now opens the results modal immediately and shows pending/running/completed states plus live summary counts as each process deploy finishes.
- [x] ~~**Deploy environment diagnostics**~~ — ✅ DONE. Deploy results now include detected package manager plus install command/skip context in the dashboard result cards.
- [x] ~~**Parallel bulk deploy mode**~~ — ✅ DONE. Added a 1×–4× bulk deploy concurrency selector in the dashboard and bounded parallel workers for faster group rollouts.
- [x] ~~**Deploy history diagnostics**~~ — ✅ DONE. History view now shows deploy package manager, install command, and directory metadata for past deploy events.
- [x] ~~**Per-group deploy presets**~~ — ✅ DONE. The dashboard now remembers bulk deploy concurrency separately for each group and restores it when the group filter changes.
- [x] ~~**Expandable history details**~~ — ✅ DONE. History rows now use collapsible detail sections so long metadata stays compact by default.
- [x] ~~**Deploy preset reset UI**~~ — ✅ DONE. Added a toolbar button to clear the saved deploy concurrency preset for the current group (or All Groups).
- [x] ~~**History metadata copy actions**~~ — ✅ DONE. History detail rows now provide one-click copy buttons for directories and install commands.
- [x] ~~**Deploy preset source indicator**~~ — ✅ DONE. Deploy toolbar now displays whether the current concurrency comes from a saved preset or the default value.
- [x] ~~**History metadata filtering**~~ — ✅ DONE. Added a metadata filter input to the History modal for matching package manager, directory, install command, and other metadata values.
- [x] ~~**Preset scope visibility**~~ — ✅ DONE. Toolbar now renders chips for scopes that currently have saved deploy presets, highlighting the active one.
- [x] ~~**History chip-to-filter interaction**~~ — ✅ DONE. Clicking a metadata chip now populates the metadata filter and re-renders the History list immediately.
- [x] ~~**Preset scope quick-switch**~~ — ✅ DONE. Clicking a saved preset scope chip now switches the group filter and restores that scope’s deploy settings immediately.
- [x] ~~**Multi-value history filters**~~ — ✅ DONE. Metadata filtering now supports comma-separated stacked values, and chip clicks append instead of replacing.
- [x] ~~**Clickable history process/event badges**~~ — ✅ DONE. Existing History process and event labels now populate the corresponding filters when clicked.
- [x] ~~**History filter clear controls**~~ — ✅ DONE. History modal now has a clear button that resets all active filters at once.
- [x] ~~**Deploy result → history shortcut**~~ — ✅ DONE. Deploy result cards now have a History action that opens the History modal pre-filtered to that process’s deploy events.
- [x] ~~**Deploy result history jump**~~ — ✅ DONE. Deploy result cards now jump into filtered History, scroll to the matching entry, and highlight it.
- [x] ~~**History → process jump**~~ — ✅ DONE. History process labels now open the related process drawer directly, while a small inline Filter action preserves filtering.
- [x] ~~**Persistent history jump state**~~ — ✅ DONE. History jump targets now persist in session storage so reloads/reopenings can restore the highlighted target.
- [x] ~~**History row action polish**~~ — ✅ DONE. History rows now use a more consistent action pattern with grouped process actions and unified button styling.
- [x] ~~**History action grouping**~~ — ✅ DONE. History rows now use an explicit Actions menu so row content stays cleaner while controls remain available.
- [x] ~~**History density modes**~~ — ✅ DONE. The History modal now supports cozy/compact density modes and remembers the selected mode locally.
- [x] ~~**History action shortcuts toggle**~~ — ✅ DONE. The History modal now has a persistent Shortcuts toggle that swaps row shortcuts between interactive controls and plain labels.
- [x] ~~**History default details preference**~~ — ✅ DONE. The History modal now remembers whether detail sections should open collapsed or expanded by default.
- [x] ~~**History keyboard navigation**~~ — ✅ DONE. The History modal now supports keyboard row navigation plus keyboard actions for open, filtering, and details toggling.
- [x] ~~**History row state memory**~~ — ✅ DONE. The History modal now preserves each row’s detail expansion state across in-session re-renders.
- [x] ~~**History keyboard shortcut hints**~~ — ✅ DONE. The History modal now shows inline key hints for navigation, open, filter, details toggle, and close actions.
- [x] ~~**History focus restoration**~~ — ✅ DONE. The History modal now restores keyboard focus to the same entry after filtering/re-rendering when that row still exists.
- [x] ~~**History hints minimization**~~ — ✅ DONE. The History keyboard hint strip can now be hidden or shown, and that preference is remembered locally.
- [x] ~~**History focus status indicator**~~ — ✅ DONE. The History modal now shows a live status pill for the currently keyboard-active row and its position in the filtered list.
- [x] ~~**History hint density**~~ — ✅ DONE. The History keyboard hint strip now supports persistent compact and full display modes.
- [x] ~~**History focus jump actions**~~ — ✅ DONE. The History chrome now includes previous/next focus controls for mouse users navigating the active row.
- [x] ~~**History hint personalization**~~ — ✅ DONE. The History shortcut strip now supports per-group visibility controls for each hint category.
- [ ] **History focus auto-open** — Optional mode to open the drawer automatically when stepping through History rows
- [ ] **History hint presets** — Add preset visibility modes like Minimal / Navigation / All for the hint strip

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
