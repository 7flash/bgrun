# ADR-004: Emit a Built `dist/api.js` Alongside the CLI

## Status
**Accepted** — 2026-03-29

## Context
ADR-003 established the staged migration plan away from publishing runtime `src/` as the only programmatic API entrypoint. The first concrete implementation step is to produce a built public API artifact in `dist/` without yet switching package exports.

Current state:
- `src/build.ts` only builds `src/index.ts` into `dist/index.js`
- `package.json` still points `main`/`exports` at `src/api.ts`
- the published package already includes `dist/`, so adding a built API artifact is low-risk as long as exports do not change yet

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Keep only CLI build for now | No code changes | Blocks the staged migration plan |
| B. Build both `src/index.ts` and `src/api.ts` into `dist/` but keep exports unchanged | Creates the migration target with minimal user-facing risk | Slightly more build output to maintain |
| C. Build both and immediately flip exports to `dist/api.js` | Fastest path to cleaner package | Too risky without compatibility smoke tests |

## Decision
**Option B** — emit `dist/api.js` now, but do not change `main`/`exports` yet.

Implementation rules:
- `src/build.ts` should build both CLI and API entrypoints.
- `dist/index.js` remains the CLI binary target.
- `dist/api.js` becomes an internal migration artifact for validation and future export switching.
- Package exports remain unchanged until compatibility tests are added.

## Consequences
- The package gets a concrete built API target immediately.
- Existing users are not disrupted because `main`/`exports` still resolve the current `src/api.ts` path.
- Future work can now add smoke tests against `dist/api.js` before changing package exports.
