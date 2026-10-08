# PRD: Managed Process Isolation and Local CLI Homes

## Problem

SDK-started processes currently inherit both an implicit lifecycle parent and, on Windows, inheritable OS handles from the SDK caller. Stopping or restarting a web process can therefore stop unrelated registered workers or leave its listening socket held by a surviving worker. The CLI also defaults to the global home even when a project configures `[bgr] local_home`.

## Constraints

- Preserve explicit parent/child cascade behavior for callers that request it.
- Preserve existing process records and their parent metadata across ordinary restarts.
- Do not terminate a PID registered to another bgrun process while cleaning an OS process tree.
- Keep forceful port cleanup behavior unchanged.
- Avoid a new daemon or runtime dependency.

## Acceptance Criteria

- [x] Existing implicit lifecycle parenting remains the default, while `detached: true` explicitly opts a process out.
- [x] SDK `get()` and `list()` results expose the stored parent name.
- [x] Tree termination skips other registered process PIDs and their descendant subtrees on Windows, and skips registered direct children on Unix.
- [ ] Windows SDK launches do not inherit the caller's listening socket. Blocked on a reliable clean-handle spawn primitive; Bun does not currently expose handle inheritance control, and the tested Win32 provider wrapper was not re-entrant for nested SDK starts.
- [x] `bgrun --home <path>` selects an explicit process home.
- [x] In a project directory, `[bgr] local_home` in `.config.toml` selects the CLI home when no explicit home/environment override exists.
- [x] Tests cover parent opt-in, protected tree selection, and CLI-home resolution.

## Solution Sketch

Add an explicit SDK detachment option while preserving implicit lifecycle parenting for compatibility, expose parentage in structured SDK descriptions, and protect registered PIDs during process-tree termination. Bootstrap the CLI runtime before its first database access from `--home`, `BGRUN_HOME`, or project config, in that precedence order. Resolve Windows handle isolation with a runtime/native spawn primitive that can set `bInheritHandles = FALSE` without breaking nested SDK starts.
