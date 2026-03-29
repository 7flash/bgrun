# ADR-006: Defer Removing Published `src/` Until Dashboard Routes Stop Importing It

## Status
**Accepted** — 2026-03-29

## Context
After switching the package API entrypoints to `dist/api.js`, the next planned cleanup step was to stop publishing runtime `src/` files.

However, the published dashboard route files under `dashboard/app/api/` still directly import many modules from `src/`, including:

- `src/db`
- `src/platform`
- `src/server`
- `src/deploy`
- `src/deps`
- `src/utils`
- `src/commands/run`
- `src/log-rotation`

That means removing `src/` from the published package today would break the dashboard backend even though the default package API now resolves through `dist/api.js`.

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Remove published `src/` now anyway | Smallest package immediately | Breaks dashboard API routes in the published package |
| B. Keep publishing `src/` until dashboard routes are migrated | Safe, preserves current runtime behavior | Delays the final cleanup step |
| C. Migrate dashboard routes to built `dist/` exports first, then remove `src/` | Completes the cleanup safely | Requires additional route/refactor work before the final publish cleanup |

## Decision
**Option C**, with **Option B** as the immediate operational stance.

Meaning:
- Do **not** remove published runtime `src/` yet.
- Treat the real next implementation step as migrating dashboard route imports away from `src/*`.
- Only after the dashboard runtime no longer depends on published source files should we remove `src/` from the package.

## Consequences
- The package keeps shipping runtime `src/` a bit longer than planned.
- We avoid breaking the dashboard backend.
- The next cleanup task is now explicit: move dashboard route/runtime imports onto built artifacts or another stable internal compatibility layer before removing `src/` from the tarball.
