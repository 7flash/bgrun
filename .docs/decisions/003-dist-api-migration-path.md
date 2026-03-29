# ADR-003: Migration Path Toward a Built `dist/api.js`

## Status
**Accepted** — 2026-03-29

## Context
`bgrun` currently has a mixed publish model:

- CLI entrypoint: `dist/index.js`
- Programmatic Bun API: `src/api.ts`

ADR-002 intentionally kept shipping the runtime `src/` subset because removing it immediately would break Bun consumers importing from `bgrun`.

We still want a path toward a cleaner package where both the CLI and public API are served from built artifacts in `dist/`, but we cannot do that as a one-step switch because:

- `src/api.ts` re-exports many runtime modules from `src/`
- the current build only emits the CLI bundle
- `package.json` still points `main`/`exports` at `./src/api.ts`
- a bad packaging move would break operational automation using the API surface

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Flip `main`/`exports` to `dist/` immediately | Fastest to smaller package | High-risk break because no built API artifact exists yet |
| B. Keep current state indefinitely | Safest short-term | Mixed package model persists forever |
| C. Add a staged migration plan with a built API artifact and compatibility window | Lowest-risk route to a cleaner package | Requires build/export work across multiple releases |

## Decision
**Option C** — use a staged migration instead of an abrupt switch.

Planned phases:

1. **Build phase**
   - Extend `src/build.ts` to emit a built public API artifact alongside the CLI, e.g. `dist/api.js`.
   - Ensure the runtime modules re-exported by `src/api.ts` are available from built `dist/*` entrypoints.

2. **Dual-entry compatibility phase**
   - Keep `src/` runtime files published.
   - Add `dist/api.js` and optionally a compatibility export path for internal verification.
   - Add smoke tests proving `import { ... } from 'bgrun'` works against the built artifact.

3. **Export migration phase**
   - Move `main`/`exports["."]` from `./src/api.ts` to `./dist/api.js`.
   - Keep the `src/` runtime subset published for one compatibility release if needed.

4. **Cleanup phase**
   - Once verified, stop publishing runtime `src/` files that are no longer required.
   - Retain only built `dist/` artifacts plus source files intentionally shipped for development/reference.

## Consequences
- We avoid a breaking packaging switch today.
- We now have a clear sequence for getting to `dist/`-first publishing safely.
- Future work should implement the build artifact and compatibility tests before touching `main`/`exports`.
- The package remains mixed for now, but only by explicit decision rather than ambiguity.
