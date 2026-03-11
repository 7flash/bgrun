# bgrun — Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Dashboard unreachable after restart (zombie port)**~~ — ✅ DONE. Dead PIDs leave CloseWait sockets on port 3000 (Windows kernel issue). Added `cleanupPort()` that detects zombie PIDs and falls back to port+1 (3001).
- [ ] **Guard not auto-enabled for new processes** — Guard requires `BGR_KEEP_ALIVE=true` in each process env. Users expect guard to work by default. Consider: (a) "Guard All" button should persist, (b) new processes created via dashboard default to guarded.

## 🟡 Priority: Improve
- [ ] **Dashboard port should be sticky** — After falling back to 3001, the dashboard stays on 3001 even after zombie clears. Should periodically re-check if preferred port (3000) is available and migrate back.
- [ ] **Guard restart logging** — Guard restarts are logged to stdout but not visible in the dashboard UI. Add a "Guard Activity" section showing recent auto-restarts with timestamps.

## 📝 Architecture Notes
- **Version**: v3.12.0
- **Dashboard port**: 3000 (fallback to 3001 if zombie socket detected)
- **Guard interval**: 30 seconds
- **Guard opt-in**: `BGR_KEEP_ALIVE=true` in process env
- **DB**: `~/.bgr/bgr_v2.sqlite` (sqlite-zod-orm)
- **Dashboard**: Melina.js (file-based routing under `dashboard/app/`)
- **CLI**: `bgrun` (global, built via `src/build.ts`)
