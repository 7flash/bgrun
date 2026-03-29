# ADR-005: Switch Package Exports to `dist/api.js`

## Status
**Accepted** — 2026-03-29

## Context
ADR-003 defined the staged migration toward built API entrypoints.
ADR-004 added `dist/api.js` to the build.
Built-API smoke coverage now proves `dist/api.js` matches `src/api.ts` for the current public surface.

The package still points:
- `main` → `./src/api.ts`
- `exports["."]` → `./src/api.ts`

That keeps the old mixed publish model alive even though a compatible built API artifact now exists.

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Keep exports on `src/api.ts` longer | Maximum conservatism | Delays the actual migration indefinitely |
| B. Switch `main`/`exports` to `dist/api.js` now that build + smoke tests exist | Completes the next migration phase with validation already in place | Still a behavior change for package consumers, so it should ship as a compatibility-focused release |
| C. Add another parallel export key first and postpone the default switch | Extra transition cushion | More complexity without clear evidence it is needed |

## Decision
**Option B** — switch `main` and `exports["."]` to `./dist/api.js` now.

Guardrails:
- Keep publishing the runtime `src/` subset for one more compatibility window.
- Keep `dist/api.js` covered by smoke tests.
- Do not remove published runtime `src/` files yet.

## Consequences
- The package default API now resolves to a built artifact instead of raw runtime source.
- The publish model becomes materially cleaner while still retaining a fallback compatibility window because `src/` remains shipped.
- Future work can decide when to stop publishing runtime `src/` entirely.
