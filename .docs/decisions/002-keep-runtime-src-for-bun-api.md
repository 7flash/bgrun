# ADR-002: Keep Runtime `src/` Files in the Published Package for Now

## Status
**Accepted** — 2026-03-29

## Context
`bgrun` is both:

1. a CLI package (`bin: dist/index.js`)
2. a Bun-native programmatic API (`import { ... } from 'bgrun'`)

Today, `package.json` points the public API at `./src/api.ts` via `main` and `exports`, while the CLI ships from `dist/index.js`.

Recent package cleanup removed obvious publish cruft (`src/index_copy.ts`, test files, etc.), which surfaced the next design question: should `bgrun` stop shipping runtime `src/` files entirely and move fully to built `dist/` entrypoints?

Constraints:
- Existing Bun consumers may rely on `import ... from 'bgrun'` resolving to the current TypeScript API surface.
- `src/api.ts` re-exports many other `src/*` modules, so removing runtime `src/` today would break the public API unless a parallel built API artifact is added and verified.
- The current build only emits the CLI entry (`dist/index.js`), not a built public API module tree.
- This package is actively used for operational tooling; a packaging regression would be high-impact.

## Options Evaluated

| Option | Pros | Cons |
|--------|------|------|
| A. Stop shipping `src/` now and point exports to `dist/` | Smaller package, cleaner runtime story | Breaking/risky today because `dist/` does not yet contain a built API equivalent to `src/api.ts` |
| B. Keep shipping runtime `src/` for now, but trim non-runtime files | Preserves Bun API compatibility, low risk, already aligns with current exports | Package remains slightly larger and still has mixed `src` + `dist` publish model |
| C. Ship both `src/` and a new built `dist/api.js`, then migrate later | Clean migration path with compatibility window | More implementation work now: build changes, export changes, compatibility verification |

## Decision
**Option B** — keep shipping the runtime `src/` files for now, but only the actual runtime subset.

Specifically:
- Continue publishing `src/api.ts` and its runtime dependency tree because the package API currently resolves there.
- Continue publishing `dist/index.js` for the CLI.
- Exclude non-runtime `src/` artifacts such as tests and backup copies.
- Treat any move to `dist/`-only API entrypoints as a separate migration project that must first add a built API artifact and compatibility validation.

## Consequences
- **No immediate breaking change** for Bun API consumers.
- **Smaller tarball than before**, but not the absolute minimum possible package.
- **Packaging model stays mixed** (`src` for API, `dist` for CLI) until a dedicated API-build migration is implemented.
- Future work should explicitly design and test a `dist/api.js` migration before removing runtime `src/` from the published package.
