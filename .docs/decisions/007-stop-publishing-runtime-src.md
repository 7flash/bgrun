# ADR-007: Stop Publishing Runtime `src/` Files Now That Dashboard Uses Built Runtime Artifacts

## Status
**Accepted** — 2026-03-29

## Context
ADR-006 deferred removal of published runtime `src/` because the published dashboard backend still imported `src/*` directly.

That blocker has now been removed:
- package exports already point to `dist/api.js`
- the build emits the extra runtime modules the dashboard needs (`dist/server.js`, `dist/deploy.js`, `dist/deps.js`, `dist/log-rotation.js`)
- dashboard backend routes now import through `dashboard/lib/runtime.ts`, which resolves to built `dist/*` artifacts instead of published `src/*`
- the current full test suite passes with this routing in place

So the package is now carrying temporary publish-time baggage that is no longer required for runtime behavior.

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Keep publishing runtime `src/` for another release anyway | Maximum conservatism | Leaves dead weight in the tarball and delays the final cleanup indefinitely |
| B. Stop publishing `src/` now, but keep repository source/tests unchanged | Removes no-longer-needed runtime baggage with low product risk | Requires validation that the tarball still contains every runtime dependency |
| C. Replace shipped `src/` with a second compatibility shadow tree | Extreme backwards cushion | Extra complexity for little value now that package exports and dashboard runtime are already on `dist/*` |

## Decision
**Option B** — stop publishing runtime `src/` files now.

Implementation rules:
- Keep repository source files exactly as the development/build source of truth.
- Remove `src/*` from `package.json` `files` so the published tarball becomes `dist`-first.
- Keep shipping the dashboard app plus its new runtime bridge.
- Update README packaging notes to describe `dist/*` as the canonical shipped runtime surface.
- Validate with `bun run build`, `bun test`, and `npm publish --dry-run` / `npm publish` tarball inspection.

## Consequences
- The published package gets smaller and simpler.
- Runtime behavior aligns with the package entrypoints and dashboard backend architecture.
- Future package consumers should treat `dist/*` artifacts and the public `bgrun` export as the supported runtime surface, not internal repository source files.
- Any hidden runtime dependency on published `src/*` should now fail during validation instead of remaining latent.
