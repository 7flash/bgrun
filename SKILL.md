---
name: bgrun
description: Lightweight Bun process manager. Use bgrun to start, stop, restart, watch, and monitor background processes — with built-in web dashboard, TOML config, Docker support, and programmatic API.
---

# bgrun — Bun Background Runner

**Use `bgrun` to manage long-running processes.** It handles spawning, PID tracking, log capture, port detection, file watching, and provides a web dashboard — all backed by SQLite.

## Quick Reference

```bash
# Install globally
bun install -g bgrun

# Start a process
bgrun --name my-api --command "bun run server.ts" --directory ~/projects/api

# List all processes
bgrun

# Watch all managed processes
bgrun top

# Print one resource snapshot
bgrun top --once

# View process details
bgrun my-api

# View logs
bgrun my-api --logs

# Stop / restart / delete
bgrun --stop my-api
bgrun --restart my-api
bgrun --delete my-api

# Launch web dashboard
bgrun --dashboard
```

---

## Architecture

```
src/
├── index.ts           # CLI entry point — parseArgs + command dispatch
├── api.ts             # Public API re-exports (package entry: "bgrun")
├── build.ts           # Bun.build script for CLI binary
├── db.ts              # SQLite database (sqlite-zod-orm) — schema, queries, mutations
├── types.ts           # CommandOptions interface
├── platform.ts        # Cross-platform process management (Windows + Unix)
├── utils.ts           # Utility functions (parseEnv, runtime calc, tailFile, version)
├── config.ts          # TOML/TS config file parser → env vars
├── logger.ts          # Boxen-based announce/error display
├── table.ts           # Terminal table rendering (hybrid horizontal + vertical tree)
├── server.ts          # Dashboard HTTP server (Melina.js)
└── commands/
    ├── run.ts         # Start/restart a process
    ├── list.ts        # Stream process status lines or emit JSON
    ├── top.ts         # Live CPU/RAM/ports monitor
    ├── logs.ts        # Show stdout/stderr logs
    ├── details.ts     # Show detailed process info
    ├── watch.ts       # Watch mode — auto-restart on file changes
    └── cleanup.ts     # Stop, delete, clean, nuke commands

dashboard/
└── app/               # Melina.js file-based routing
    ├── layout.tsx      # Root layout (header, version badge)
    ├── page.tsx        # Server-rendered page shell
    ├── page.client.tsx # Client interactivity (DOM manipulation, polling)
    ├── globals.css     # Dashboard styles
    └── api/            # REST API routes
        ├── processes/  # GET list, DELETE by name
        ├── logs/       # GET stdout/stderr by name
        ├── start/      # POST create process
        ├── stop/       # POST stop by name
        ├── restart/    # POST restart by name
        └── version/    # GET bgrun version

examples/
├── guard.ts           # Single-process guard (auto-restart)
├── guard-all.ts       # Multi-process guard (memory limits, restart intervals)
├── bgr-startup.sh     # Systemd startup script
├── bgr-startup.service # Systemd service file
├── table.ts           # Table rendering demo
├── long-worker.js     # Test worker (long-running)
└── test-worker.js     # Test worker (short-lived)

tests/
├── bgr.test.ts        # Integration tests (process start, config persistence)
└── table.test.ts      # Unit tests (column width calculation, rendering)
```

---

## Key Concepts

### Database (`src/db.ts`)

- Uses `sqlite-zod-orm` with a single `process` table
- Schema fields: `pid`, `workdir`, `command`, `name`, `env`, `configPath`, `stdout_path`, `stderr_path`, `timestamp`
- DB file lives at `~/.bgr/bgr_v2.sqlite` (configurable via `DB_NAME` env)
- `retryDatabaseOperation()` handles `SQLITE_BUSY` with exponential backoff

### Process Model (`src/types.ts` + `src/db.ts`)

- `CommandOptions` — CLI input (name, command, directory, flags)
- `Process` — DB record type (inferred from Zod schema + `id`)

### Platform Layer (`src/platform.ts`)

All process operations are cross-platform (Windows `taskkill`/`wmic`/`netstat` vs Unix `kill`/`ps`/`ss`/`lsof`):

- `isProcessRunning(pid)` — checks PID or Docker container status
- `terminateProcess(pid)` — kills children first, then parent
- `getProcessPorts(pid)` — OS-level port detection via `netstat`/`ss`
- `killProcessOnPort(port)` — force-kill anything on a port
- `findChildPid(parentPid)` — traverse process tree to find leaf PID
- `getShellCommand(cmd)` — returns `["cmd", "/c", cmd]` or `["sh", "-c", cmd]`

### Config System (`src/config.ts`)

TOML/TS config files are flattened to env vars:
```
{ server: { port: 3000 } }  →  SERVER_PORT=3000
```

### CLI Flow (`src/index.ts`)

1. `parseArgs()` extracts flags and positionals
2. Internal `--_serve` flag → start dashboard HTTP server
3. `--dashboard` → spawn the dashboard as a bgrun-managed process
4. Other flags dispatch to command handlers in `src/commands/`
5. Default: no args → `showAll()`, name only → `showDetails(name)`

---

## Development Workflow

### Build

```bash
bun run build    # Compiles src/index.ts → dist/index.js (ESM, external packages)
```

### Test

```bash
bun test                       # Run all tests
bun test tests/table.test.ts   # Run table tests only
bun test tests/bgr.test.ts     # Run integration tests (spawns processes)
```

### Run locally (dev)

```bash
bun run src/index.ts --help                   # CLI help
bun run src/index.ts --name test --command "bun --version" --directory .
bun run src/index.ts                          # List processes
bun run src/index.ts --dashboard              # Launch dashboard
```

### Publish

```bash
bun run build
npm publish
```

---

## Common Tasks

### Adding a new CLI flag

1. Add the flag to `parseArgs()` options in `src/index.ts`
2. Add it to the `showHelp()` text
3. Handle it in the command dispatch section of `run()`
4. If it needs new types, add to `CommandOptions` in `src/types.ts`
5. Export new functionality from `src/api.ts` if it should be public

### Adding a new dashboard API endpoint

1. Create `dashboard/app/api/<endpoint>/route.ts`
2. Export handler functions: `GET`, `POST`, `DELETE`, etc.
3. Import from `../../src/...` for database/platform access

### Modifying the database schema

1. Update the Zod schema in `src/db.ts`
2. The `Process` type is auto-inferred from the schema
3. Update any insert/query functions that reference changed fields
4. Bump the database filename version suffix if migration is needed

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BGRUN_HOME` | bgrun state directory (default: `~/.bgr`) |
| `BGRUN_DB` | SQLite filename or absolute path (default: `bgrun.sqlite`) |
| `DB_NAME` | Custom database file name (default: `bgr`) |
| `BGR_GROUP` | Assign process to a group for `--filter` |
| `BUN_PORT` | Explicit dashboard port (no fallback) |
| `BGR_KEEP_ALIVE` | Set `true` on a process for guard scripts to monitor |
| `BGR_MEMORY_LIMIT` | Memory limit for guard scripts (e.g. `500m`) |
| `BGR_RESTART_INTERVAL` | Auto-restart interval in minutes for guard scripts |

---

## Programmatic API

Prefer the high-level SDK. The default export is a lazy singleton:

```typescript
import bgrun from "bgrun"

bgrun.configure({ home: ".data/bgrun" })

await bgrun.start({
  name: "api",
  command: "bun run server.ts",
  cwd: "./server",
})

await bgrun.restart("api")
await bgrun.stop("api")
console.log(await bgrun.list())
```

For isolated stores or reusable libraries, create an explicit instance:

```typescript
import { createBgrun } from "bgrun"

const manager = createBgrun({
  home: ".data/bgrun",
  db: "processes.sqlite",
})

await manager.ensure({
  name: "worker",
  command: "bun run worker.ts",
  cwd: "./worker",
})
```

Primary methods: `start`, `ensure`, `restart`, `stop`, `remove`, `get`, `list`, `logs`, and `resources`.

Use low-level exports such as `db`, `terminateProcess`, and direct row mutation only for advanced tooling. `handleRun` and `handleStop` are compatibility exports, not the preferred SDK API.

---

## Full CLI Reference

| Option | Description |
|--------|-------------|
| `--name <name>` | Process name (required for start) |
| `--command <cmd>` | Command to execute (required for start) |
| `--directory <path>` | Working directory (required for start) |
| `--config <path>` | Config file (default: `.config.toml`) |
| `--force` | Kill existing + clean ports |
| `--fetch` | Git pull before start |
| `--watch` | Auto-restart on file changes |
| `--stdout <path>` | Custom stdout path |
| `--stderr <path>` | Custom stderr path |
| `--json` | Fast JSON output for list |
| `--json-full` | Verified JSON with status and ports |
| `--filter <group>` | Filter by `BGR_GROUP` |
| `--top` | Alias for `bgrun top` |
| `--once` | Top: print one snapshot and exit |
| `--logs` | Show logs |
| `--log-stdout` | Stdout only |
| `--log-stderr` | Stderr only |
| `--lines <n>` | Number of log lines |
| `--stop <name>` | Stop a process |
| `--restart <name>` | Restart a process |
| `--delete <name>` | Delete a process |
| `--clean` | Remove stopped processes |
| `--nuke` | Delete ALL processes |
| `--dashboard` | Launch web dashboard |
| `--port <n>` | Dashboard port (default: 3000) |
| `--version` | Show version |
