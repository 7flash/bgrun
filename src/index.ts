#!/usr/bin/env bun

import { parseArgs } from "util";
import { getVersion } from "./utils";
import { handleRun } from "./commands/run";
import { showAll } from "./commands/list";
import { handleDelete, handleClean, handleDeleteAll, handleStop } from "./commands/cleanup";
import { handleWatch } from "./commands/watch";
import { showLogs } from "./commands/logs";
import { showDetails } from "./commands/details";
import { handleEnvit, parseEnvitArgs } from "./commands/envit";
import { handleInline, parseInlineArgs } from "./commands/inline";
import { handleGuardToggle } from "./commands/guard";
import type { CommandOptions } from "./types";
import { error, announce } from "./logger";
// startServer is dynamically imported only when --_serve is used
// to avoid loading melina (which has side-effects) on every bgrun command
import { getHomeDir, getShellCommand, findChildPid, isProcessRunning, terminateProcess, getProcessPorts, killProcessOnPort, waitForPortFree, isPortFree, findPidByPort, psExec, resolvePidWithPorts } from "./platform";
import { insertProcess, removeProcessByName, getProcess, retryDatabaseOperation, getDbInfo, updateProcessPid } from "./db";
import dedent from "dedent";
import chalk from "chalk";
import { join } from "path";
import { sleep } from "bun";
import { configure } from "measure-fn";
import { startProcessWatcher } from "./watcher";
import { generateAutoProcessName, joinCommandArgs } from "./cli-helpers";

if (!Bun.argv.includes("--_serve")) {
  if (!Bun.env.MEASURE_SILENT) {
    configure({ silent: true });
  }
}

/**
 * Redirect console.log/warn/error to log files when running detached.
 * The parent spawner passes file paths via BGR_STDOUT/BGR_STDERR env vars.
 * Appends timestamped lines so `bgrun <name> --logs` shows real output.
 */
function redirectConsoleToFiles() {
  const stdoutPath = Bun.env.BGR_STDOUT;
  const stderrPath = Bun.env.BGR_STDERR;
  if (!stdoutPath && !stderrPath) return; // Not detached, keep normal console

  const { appendFileSync } = require('fs');

  // Strip ANSI escape codes for clean log files
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const timestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (stdoutPath) {
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: any[]) => {
      const line = `[${timestamp()}] ${stripAnsi(args.map(String).join(' '))}\n`;
      try { appendFileSync(stdoutPath, line); } catch { }
      origLog.apply(console, args); // Also keep original (goes to /dev/null when detached, but useful if attached)
    };
    console.warn = (...args: any[]) => {
      const line = `[${timestamp()}] WARN: ${stripAnsi(args.map(String).join(' '))}\n`;
      try { appendFileSync(stdoutPath, line); } catch { }
      origWarn.apply(console, args);
    };
  }

  if (stderrPath) {
    const origError = console.error;
    console.error = (...args: any[]) => {
      const line = `[${timestamp()}] ERROR: ${stripAnsi(args.map(String).join(' '))}\n`;
      try { appendFileSync(stderrPath, line); } catch { }
      origError.apply(console, args);
    };
  }
}

async function findDetachedProcessByArg(snippet: string): Promise<number | null> {
  if (process.platform !== 'win32') return null;

  try {
    const result = await psExec(
      `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | Where-Object { $_.CommandLine -match '${snippet.replace(/'/g, "''")}' } | Sort-Object -Property CreationDate -Descending | Select-Object -First 1 -ExpandProperty ProcessId`,
      3000
    );
    const pid = parseInt(result.trim(), 10);
    return !isNaN(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function showHelp() {
  const usage = dedent`
    ${chalk.bold('bgrun — Bun Background Runner')}
    ${chalk.gray('═'.repeat(50))}

    ${chalk.yellow('Usage:')}
      bunx bgrun [name] [options]

    ${chalk.yellow('Commands:')}
      bunx bgrun                     List all processes
      bunx bgrun [name]             Show details for a process
      bunx bgrun -- <cmd>           Start a managed process named from the working directory
      bunx bgrun inline -- <cmd>    Run a command in this terminal with config env loaded
      bunx bgrun --env              Print shell commands to export config env vars
      bunx bgrun --dashboard        Launch web dashboard (managed by bgrun)
      bunx bgrun [name] --guard     Enable crash watcher for a process
      bunx bgrun [name] --guard-off Disable crash watcher for a process
      bunx bgrun --restart [name]   Restart a process
      bunx bgrun --restart-all      Restart ALL registered processes
      bunx bgrun --stop [name]      Stop a process (keep in registry)
      bunx bgrun --stop-all         Stop ALL running processes
      bunx bgrun --delete [name]    Delete a process
      bunx bgrun --clean            Remove all stopped processes
      bunx bgrun --nuke             Delete ALL processes
      bunx bgrun --kill-port <n>    Kill whatever is currently listening on a port

    ${chalk.yellow('Options:')}
      --name <string>        Process name (required for new)
      --command <string>     Process command (required for new)
      --directory <path>     Working directory (required for new)
      --config <path>        Config file (default: .config.toml)
      --no-config            Disable automatic .config.toml loading
      --env                  Print shell export commands from config and exit
      --shell <type>         Shell for --env: powershell | cmd | sh | json
      --watch                Watch for file changes and auto-restart
      --hot                  Restart the managed process when files change
      --force                Force restart existing process
      --fetch                Fetch latest git changes before running
      --json                 Output in JSON format
      --filter <group>       Filter list by BGR_GROUP
      --logs                 Show logs
      --log-stdout           Show only stdout logs
      --log-stderr           Show only stderr logs
      --lines <n>            Number of log lines to show (default: all)
      --version              Show version
      --debug                Show debug info (DB path, BGR home, etc.)
      --dashboard            Launch web dashboard as bgrun-managed process
      --guard                Enable per-process crash watcher
      --guard-off            Disable per-process crash watcher
      --kill-port <number>   Kill the process currently using a port
      --port <number>        Port for dashboard (default: 3000)
      --help                 Show this help message

    ${chalk.yellow('Examples:')}
      bunx bgrun -- bun run dev
      bunx bgrun --hot -- bun run index.ts
      bunx bgrun --no-config -- bun run script.ts
      bunx bgrun --force -- bun run server.ts
      bunx bgrun inline -- bun run dev
      Invoke-Expression (bunx bgrun --env)
      eval "$(bunx bgrun --env --shell sh)"
      bunx bgrun --dashboard
      bunx bgrun --kill-port 3000
      bunx bgrun myapp --guard
      bunx bgrun myapp --guard-off
      bunx bgrun --name myapp --command "bun run dev" --directory . --watch
      bunx bgrun myapp --logs --lines 50
  `;
  console.log(usage);
}

const cliArgOptions = {
  name: { type: 'string' as const },
  command: { type: 'string' as const },
  directory: { type: 'string' as const },
  config: { type: 'string' as const },
  "no-config": { type: 'boolean' as const },
  env: { type: 'boolean' as const },
  shell: { type: 'string' as const },
  watch: { type: 'boolean' as const },
  hot: { type: 'boolean' as const },
  force: { type: 'boolean' as const },
  fetch: { type: 'boolean' as const },
  delete: { type: 'boolean' as const },
  nuke: { type: 'boolean' as const },
  restart: { type: 'boolean' as const },
  "restart-all": { type: 'boolean' as const },
  stop: { type: 'boolean' as const },
  "stop-all": { type: 'boolean' as const },
  clean: { type: 'boolean' as const },
  json: { type: 'boolean' as const },
  logs: { type: 'boolean' as const },
  "log-stdout": { type: 'boolean' as const },
  "log-stderr": { type: 'boolean' as const },
  lines: { type: 'string' as const },
  filter: { type: 'string' as const },
  version: { type: 'boolean' as const },
  help: { type: 'boolean' as const },
  db: { type: 'string' as const },
  stdout: { type: 'string' as const },
  stderr: { type: 'string' as const },
  dashboard: { type: 'boolean' as const },
  guard: { type: 'boolean' as const },
  "guard-off": { type: 'boolean' as const },
  debug: { type: 'boolean' as const },
  "kill-port": { type: 'string' as const },
  "_serve": { type: 'boolean' as const },
  "_watch-process": { type: 'string' as const },
  port: { type: 'string' as const },
};

// Re-running parseArgs logic properly
async function run() {
  const rawArgs = Bun.argv.slice(2);
  const isActionInvocation = (values: Record<string, unknown>) => {
    return Boolean(
      values.dashboard ||
      values.guard ||
      values['guard-off'] ||
      values.version ||
      values.help ||
      values.debug ||
      values['kill-port'] ||
      values.nuke ||
      values.clean ||
      values['restart-all'] ||
      values['stop-all'] ||
      values.delete ||
      values.restart ||
      values.stop ||
      values.logs ||
      values['log-stdout'] ||
      values['log-stderr'] ||
      values.watch ||
      values.hot ||
      values.json ||
      values.filter
    );
  };

  if (rawArgs[0] === "inline") {
    const parsed = parseInlineArgs(rawArgs.slice(1));
    if (parsed.help) {
      console.log(dedent`
        ${chalk.bold('bgrun inline')}
        ${chalk.gray('─'.repeat(40))}

        Run a command in the current terminal with env vars loaded from a bgrun config file.

        Usage:
          bunx bgrun inline [--directory <path>] [--config <path>] -- <command> [args...]

        Examples:
          bunx bgrun inline -- bun run dev
          bunx bgrun inline --directory apps/api -- node server.js
      `);
      return;
    }

    await handleInline(parsed);
    return;
  }

  const delimiterIndex = rawArgs.indexOf("--");
  if (delimiterIndex !== -1 && delimiterIndex < rawArgs.length - 1) {
    const preArgs = rawArgs.slice(0, delimiterIndex);
    const commandArgs = rawArgs.slice(delimiterIndex + 1);
    const { values } = parseArgs({
      args: preArgs,
      options: cliArgOptions,
      strict: false,
      allowPositionals: true,
    });

    const inlineCommand = joinCommandArgs(commandArgs);
    const directory = (values.directory as string | undefined) || process.cwd();
    const autoName = (values.name as string | undefined) || generateAutoProcessName(directory);
    const watchLike = Boolean(values.watch || values.hot);

    const runOptions = {
      action: watchLike ? 'watch' : 'run',
      name: autoName,
      command: inlineCommand,
      directory,
      configPath: (values['no-config'] as boolean | undefined) ? '' : values.config as string | undefined,
      force: values.force as boolean | undefined,
      fetch: values.fetch as boolean | undefined,
      remoteName: '',
      dbPath: values.db as string | undefined,
      stdout: values.stdout as string | undefined,
      stderr: values.stderr as string | undefined
    } as CommandOptions;

    if (watchLike) {
      await handleWatch(runOptions, {
        showLogs: (values.logs as boolean) || false,
        logType: values["log-stdout"] ? 'stdout' : (values["log-stderr"] ? 'stderr' : 'both'),
        lines: values.lines ? parseInt(values.lines as string) : undefined
      });
    } else {
      await handleRun(runOptions);
    }
    return;
  }

  const { values, positionals } = parseArgs({
    args: rawArgs,
    options: cliArgOptions,
    strict: false,
    allowPositionals: true,
  });

  if (values.env) {
    if (positionals.length > 1) {
      error("Too many positional arguments for --env. Use --config <path> or pass a single config path.");
    }

    await handleEnvit({
      directory: values.directory as string | undefined,
      configPath: (values.config as string | undefined) || positionals[0],
      shell: values.shell as any,
    });
    return;
  }

  if (
    positionals.length > 1 &&
    !values.command &&
    !isActionInvocation(values as Record<string, unknown>)
  ) {
    const implicitCommand = joinCommandArgs(positionals);
    const directory = (values.directory as string | undefined) || process.cwd();
    const autoName = (values.name as string | undefined) || generateAutoProcessName(directory);
    const watchLike = Boolean(values.watch || values.hot);

    const runOptions = {
      action: watchLike ? 'watch' : 'run',
      name: autoName,
      command: implicitCommand,
      directory,
      configPath: (values['no-config'] as boolean | undefined) ? '' : values.config as string | undefined,
      force: values.force as boolean | undefined,
      fetch: values.fetch as boolean | undefined,
      remoteName: '',
      dbPath: values.db as string | undefined,
      stdout: values.stdout as string | undefined,
      stderr: values.stderr as string | undefined
    } as CommandOptions;

    if (watchLike) {
      await handleWatch(runOptions, {
        showLogs: (values.logs as boolean) || false,
        logType: values["log-stdout"] ? 'stdout' : (values["log-stderr"] ? 'stderr' : 'both'),
        lines: values.lines ? parseInt(values.lines as string) : undefined
      });
    } else {
      await handleRun(runOptions);
    }
    return;
  }

  // Internal: actually run the HTTP server (spawned by --dashboard)
  // Port is NOT passed explicitly — Melina auto-detects from BUN_PORT env
  // or defaults to 3000 with fallback to next available port.
  if (values['_serve']) {
    // Redirect console output to log files when running detached
    // The spawner passes paths via BGR_STDOUT/BGR_STDERR env vars
    redirectConsoleToFiles();
    const { startServer } = await import("./server");
    await startServer();
    return;
  }

  // Internal: watcher loop for a single guarded process
  if (values['_watch-process']) {
    // Redirect console output to log files when running detached
    redirectConsoleToFiles();
    await startProcessWatcher(String(values['_watch-process']));
    return;
  }

  // Dashboard: spawn the dashboard server as a bgr-managed process
  if (values.dashboard) {
    const dashboardName = 'bgr-dashboard';
    const homePath = getHomeDir();
    const bgrDir = join(homePath, '.bgr');
    // User can request a specific port via --port or BUN_PORT=XXXX bgrun --dashboard
    // Otherwise Melina picks automatically (3000 → fallback)
    const requestedPort = values.port as string | undefined;
    const explicitPortValue = requestedPort || Bun.env.BUN_PORT || undefined;
    const explicitPort = explicitPortValue ? parseInt(explicitPortValue, 10) : null;

    // Check if dashboard is already running
    const existing = getProcess(dashboardName);
    if (existing && await isProcessRunning(existing.pid)) {
      // The stored PID may be a shell wrapper. Resolve toward the child that
      // actually owns the listening socket before rendering the banner.
      const resolved = await resolvePidWithPorts(existing.pid);
      let existingPid = resolved.pid;
      let existingPorts = resolved.ports;

      if (existingPorts.length === 0) {
        const detachedPid = await findDetachedProcessByArg('--_serve');
        if (detachedPid && detachedPid !== existingPid) {
          const detachedResolved = await resolvePidWithPorts(detachedPid);
          existingPid = detachedResolved.pid;
          existingPorts = detachedResolved.ports;
        }
      }

      if (existingPid !== existing.pid && existingPorts.length > 0) {
        await retryDatabaseOperation(() => updateProcessPid(dashboardName, existingPid));
      }

      const portStr = existingPorts.length > 0 ? `:${existingPorts[0]}` : '(detecting...)';
      announce(
        `Dashboard is already running (PID ${existingPid})\n\n` +
        `  🌐  ${chalk.cyan(`http://localhost${portStr}`)}\n\n` +
        `  Use ${chalk.yellow(`bgrun --stop ${dashboardName}`)} to stop it\n` +
        `  Use ${chalk.yellow(`bgrun --dashboard --force`)} to restart`,
        'BGR Dashboard'
      );
      return;
    }

    // Kill existing if force
    if (existing) {
      if (await isProcessRunning(existing.pid)) {
        const detectedPorts = await getProcessPorts(existing.pid);
        await terminateProcess(existing.pid);
        for (const p of detectedPorts) {
          await killProcessOnPort(p);
          await waitForPortFree(p, 5000);
        }
      }
      await retryDatabaseOperation(() => removeProcessByName(dashboardName));
    }

    // Spawn the dashboard server as a managed process
    // Port is NOT passed as CLI arg — Melina will auto-detect.
    // If user wants a specific port, we pass it via BUN_PORT env var.
    const spawnCommand = `bunx bgrun --_serve`;
    const command = `bunx bgrun --_serve`;
    const stdoutPath = join(bgrDir, `${dashboardName}-out.txt`);
    const stderrPath = join(bgrDir, `${dashboardName}-err.txt`);

    await Bun.write(stdoutPath, '');
    await Bun.write(stderrPath, '');

    // Pass BUN_PORT only when this dashboard launch explicitly requested one.
    const spawnEnv: Record<string, string> = { ...Bun.env } as any;
    if (explicitPortValue) {
      spawnEnv.BUN_PORT = explicitPortValue;
    } else {
      delete spawnEnv.BUN_PORT;
    }
    // Pass log paths so the detached process can redirect its own console output
    spawnEnv.BGR_STDOUT = stdoutPath;
    spawnEnv.BGR_STDERR = stderrPath;

    if (explicitPort && explicitPort > 0) {
      // Only reclaim a dashboard port when the user explicitly asked for one.
      const portFree = await isPortFree(explicitPort);
      if (!portFree) {
        console.log(chalk.yellow(`  ⚡ Requested dashboard port ${explicitPort} is occupied — reclaiming...`));
        await killProcessOnPort(explicitPort);
        const freed = await waitForPortFree(explicitPort, 5000);
        if (!freed) {
          console.log(chalk.red(`  ⚠ Could not free port ${explicitPort} — dashboard may pick a fallback port`));
        }
      }
    }

    const newProcess = Bun.spawn(getShellCommand(spawnCommand), {
      env: spawnEnv,
      cwd: bgrDir,
      stdout: "ignore",
      stderr: "ignore",
      detached: true, // Windows: new process group outside parent's Job Object — survives terminal close
    } as any);

    newProcess.unref();

    // With detached: cmd.exe wrapper exits immediately, so findChildPid can miss the real bun child.
    await sleep(2000); // Give the server time to start and bind a port
    let actualPid = explicitPort && explicitPort > 0
      ? (await findPidByPort(explicitPort, 10000) ?? await findChildPid(newProcess.pid))
      : await findChildPid(newProcess.pid);

    if (!(await isProcessRunning(actualPid))) {
      const detachedPid = await findDetachedProcessByArg('--_serve');
      if (detachedPid) actualPid = detachedPid;
    }

    // Detect the port the server actually bound to.
    // On Windows, the first live PID can still be a wrapper process with no ports,
    // so keep resolving toward the child that actually owns the listener.
    let actualPort: number | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const resolved = await resolvePidWithPorts(actualPid);
      actualPid = resolved.pid;
      if (resolved.ports.length > 0) {
        actualPort = resolved.ports[0];
        break;
      }

      const detachedPid = await findDetachedProcessByArg('--_serve');
      if (detachedPid && detachedPid !== actualPid) {
        actualPid = detachedPid;
      }

      await sleep(1000);
    }

    await retryDatabaseOperation(() =>
      insertProcess({
        pid: actualPid,
        workdir: bgrDir,
        command,
        name: dashboardName,
        env: '',
        configPath: '',
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
      })
    );

    const portDisplay = actualPort ? String(actualPort) : '(detecting...)';
    const urlDisplay = actualPort ? `http://localhost:${actualPort}` : 'http://localhost (port auto-assigned)';

    const msg = dedent`
      ${chalk.bold('⚡ BGR Dashboard launched')}
      ${chalk.gray('─'.repeat(40))}

        🌐  Open in browser: ${chalk.cyan.underline(urlDisplay)}
        📊  Manage all your processes from the web UI
        🔄  Auto-refreshes every 3 seconds

      ${chalk.gray('─'.repeat(40))}
        Process: ${chalk.white(dashboardName)}  |  PID: ${chalk.white(String(actualPid))}  |  Port: ${chalk.white(portDisplay)}

        ${chalk.yellow('bgrun bgr-dashboard --logs')}    View dashboard logs
        ${chalk.yellow('bgrun --stop bgr-dashboard')}    Stop the dashboard
        ${chalk.yellow('bgrun --restart bgr-dashboard')} Restart the dashboard
    `;
    announce(msg, 'BGR Dashboard');
    return;
  }

  if (values.guard || values['guard-off']) {
    await handleGuardToggle(positionals[0], Boolean(values.guard));
    return;
  }

  if (values.version) {
    console.log(`bgrun version: ${await getVersion()}`);
    return;
  }

  if (values.help) {
    await showHelp();
    return;
  }

  if (values.debug) {
    const info = getDbInfo();
    const version = await getVersion();
    console.log(dedent`
      ${chalk.bold('bgrun debug info')}
      ${chalk.gray('─'.repeat(40))}
      Version:   ${chalk.cyan(version)}
      BGR Home:  ${chalk.yellow(info.bgrHome)}
      DB Path:   ${chalk.yellow(info.dbPath)}
      DB File:   ${info.dbFilename}
      DB Exists: ${info.exists ? chalk.green('✓') : chalk.red('✗')}
      Platform:  ${process.platform}
      Bun:       ${Bun.version}
    `);
    return;
  }

  if (values['kill-port']) {
    const port = parseInt(String(values['kill-port']), 10);
    if (isNaN(port) || port <= 0) {
      error("Please provide a valid port number for --kill-port.");
    }

    const wasFree = await isPortFree(port);
    if (wasFree) {
      announce(`Port ${port} is already free.`, "Port Free");
      return;
    }

    await killProcessOnPort(port);
    const freed = await waitForPortFree(port, 5000);
    if (!freed) {
      error(`Port ${port} is still busy after attempted cleanup.`);
    }

    announce(`Freed port ${port}.`, "Port Cleanup");
    return;
  }

  // Commands flow
  if (values.nuke) {
    await handleDeleteAll();
    return;
  }

  if (values.clean) {
    await handleClean();
    return;
  }

  // Restart all registered processes
  if (values['restart-all']) {
    const { getAllProcesses } = await import('./db');
    const all = getAllProcesses();
    if (all.length === 0) {
      error('No processes registered.');
      return;
    }
    console.log(chalk.bold(`\n  Restarting ${all.length} processes...\n`));
    for (const proc of all) {
      try {
        console.log(chalk.yellow(`  ↻ Restarting ${proc.name}...`));
        await handleRun({
          action: 'run',
          name: proc.name,
          force: true,
          remoteName: '',
        });
      } catch (err: any) {
        console.error(chalk.red(`  ✗ Failed to restart ${proc.name}: ${err.message}`));
      }
    }
    console.log(chalk.green(`\n  ✓ All processes restarted.\n`));
    return;
  }

  // Stop all running processes
  if (values['stop-all']) {
    const { getAllProcesses } = await import('./db');
    const all = getAllProcesses();
    if (all.length === 0) {
      error('No processes registered.');
      return;
    }
    console.log(chalk.bold(`\n  Stopping ${all.length} processes...\n`));
    for (const proc of all) {
      try {
        if (await isProcessRunning(proc.pid)) {
          console.log(chalk.yellow(`  ■ Stopping ${proc.name} (PID ${proc.pid})...`));
          await handleStop(proc.name);
        } else {
          console.log(chalk.gray(`  ○ ${proc.name} already stopped`));
        }
      } catch (err: any) {
        console.error(chalk.red(`  ✗ Failed to stop ${proc.name}: ${err.message}`));
      }
    }
    console.log(chalk.green(`\n  ✓ All processes stopped.\n`));
    return;
  }

  const name = (values.name as string) || positionals[0];

  // Delete
  if (values.delete) {
    // bgr --delete (bool)
    if (name) {
      await handleDelete(name);
    } else {
      error("Please specify a process name to delete.");
    }
    return;
  }

  // Restart
  if (values.restart) {
    if (!name) {
      error("Please specify a process name to restart.");
    }
    await handleRun({
      action: 'run',
      name: name,
      force: true,
      // other options undefined, handleRun will look up process
      remoteName: '',
    });
    return;
  }

  // Stop
  if (values.stop) {
    if (!name) {
      error("Please specify a process name to stop.");
    }
    await handleStop(name);
    return;
  }

  // Logs
  if (values.logs || values["log-stdout"] || values["log-stderr"]) {
    if (!name) {
      error("Please specify a process name to show logs for.");
    }
    const logType = values["log-stdout"] ? 'stdout' : (values["log-stderr"] ? 'stderr' : 'both');
    const lines = values.lines ? parseInt(values.lines as string) : undefined;
    await showLogs(name, logType, lines);
    return;
  }

  // Watch
  if (values.watch || values.hot) {
    await handleWatch({
      action: 'watch',
      name: name,
      command: values.command as string | undefined,
      directory: values.directory as string | undefined,
      configPath: values.config as string | undefined,
      force: values.force as boolean | undefined,
      remoteName: '',
      dbPath: values.db as string | undefined,
      stdout: values.stdout as string | undefined,
      stderr: values.stderr as string | undefined
    }, {
      showLogs: (values.logs as boolean) || false,
      logType: 'both',
      lines: values.lines ? parseInt(values.lines as string) : undefined
    });
    return;
  }

  // Explicit "list" command
  if (name === 'list') {
    await showAll({
      json: values.json as boolean | undefined,
      filter: values.filter as string | undefined
    });
    return;
  }

  // List or Run or Details
  if (name) {
    if (!values.command && !values.directory) {
      await showDetails(name);
    } else {
      await handleRun({
        action: 'run',
        name: name,
        command: values.command as string | undefined,
        directory: values.directory as string | undefined,
        configPath: (values['no-config'] as boolean | undefined) ? '' : values.config as string | undefined,
        force: values.force as boolean | undefined,
        fetch: values.fetch as boolean | undefined,
        remoteName: '',
        dbPath: values.db as string | undefined,
        stdout: values.stdout as string | undefined,
        stderr: values.stderr as string | undefined
      });
    }
  } else {
    if (values.command) {
      error("Process name is required.");
    }
    await showAll({
      json: values.json as boolean | undefined,
      filter: values.filter as string | undefined
    });
  }
}

run().catch(err => {
  // BgrunError was already printed by error() — just exit
  // For unexpected errors, print and exit
  if (err.name !== 'BgrunError') {
    console.error(err);
  }
  process.exit(1);
});
