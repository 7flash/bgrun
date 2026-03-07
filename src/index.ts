#!/usr/bin/env bun

import { parseArgs } from "util";
import { getVersion } from "./utils";
import { handleRun } from "./commands/run";
import { showAll } from "./commands/list";
import { handleDelete, handleClean, handleDeleteAll, handleStop } from "./commands/cleanup";
import { handleWatch } from "./commands/watch";
import { showLogs } from "./commands/logs";
import { showDetails } from "./commands/details";
import type { CommandOptions } from "./types";
import { error, announce } from "./logger";
// startServer is dynamically imported only when --_serve is used
// to avoid loading melina (which has side-effects) on every bgrun command
import { getHomeDir, getShellCommand, findChildPid, isProcessRunning, terminateProcess, getProcessPorts, killProcessOnPort, waitForPortFree, isPortFree } from "./platform";
import { insertProcess, removeProcessByName, getProcess, retryDatabaseOperation, getDbInfo } from "./db";
import dedent from "dedent";
import chalk from "chalk";
import { join } from "path";
import { sleep } from "bun";
import { configure } from "measure-fn";

if (!Bun.argv.includes("--_serve")) {
  if (!Bun.env.MEASURE_SILENT) {
    configure({ silent: true });
  }
}

async function showHelp() {
  const usage = dedent`
    ${chalk.bold('bgrun — Bun Background Runner')}
    ${chalk.gray('═'.repeat(50))}

    ${chalk.yellow('Usage:')}
      bgrun [name] [options]

    ${chalk.yellow('Commands:')}
      bgrun                     List all processes
      bgrun [name]             Show details for a process
      bgrun --dashboard        Launch web dashboard (managed by bgrun)
      bgrun --guard            Launch standalone process guard
      bgrun --restart [name]   Restart a process
      bgrun --restart-all      Restart ALL registered processes
      bgrun --stop [name]      Stop a process (keep in registry)
      bgrun --stop-all         Stop ALL running processes
      bgrun --delete [name]    Delete a process
      bgrun --clean            Remove all stopped processes
      bgrun --nuke             Delete ALL processes

    ${chalk.yellow('Options:')}
      --name <string>        Process name (required for new)
      --command <string>     Process command (required for new)
      --directory <path>     Working directory (required for new)
      --config <path>        Config file (default: .config.toml)
      --watch                Watch for file changes and auto-restart
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
      --port <number>        Port for dashboard (default: 3000)
      --help                 Show this help message

    ${chalk.yellow('Examples:')}
      bgrun --dashboard
      bgrun --name myapp --command "bun run dev" --directory . --watch
      bgrun myapp --logs --lines 50
  `;
  console.log(usage);
}

// Re-running parseArgs logic properly
async function run() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      name: { type: 'string' },
      command: { type: 'string' },
      directory: { type: 'string' },
      config: { type: 'string' },
      watch: { type: 'boolean' },
      force: { type: 'boolean' },
      fetch: { type: 'boolean' },
      delete: { type: 'boolean' },
      nuke: { type: 'boolean' },
      restart: { type: 'boolean' },
      "restart-all": { type: 'boolean' },
      stop: { type: 'boolean' },
      "stop-all": { type: 'boolean' },
      clean: { type: 'boolean' },
      json: { type: 'boolean' },
      logs: { type: 'boolean' },
      "log-stdout": { type: 'boolean' },
      "log-stderr": { type: 'boolean' },
      lines: { type: 'string' },
      filter: { type: 'string' },
      version: { type: 'boolean' },
      help: { type: 'boolean' },
      db: { type: 'string' },
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      dashboard: { type: 'boolean' },
      guard: { type: 'boolean' },
      debug: { type: 'boolean' },
      "_serve": { type: 'boolean' },
      "_guard-loop": { type: 'boolean' },
      port: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });

  // Internal: actually run the HTTP server (spawned by --dashboard)
  // Port is NOT passed explicitly — Melina auto-detects from BUN_PORT env
  // or defaults to 3000 with fallback to next available port.
  if (values['_serve']) {
    const { startServer } = await import("./server");
    await startServer();
    return;
  }

  // Internal: actually run the guard loop (spawned by --guard)
  if (values['_guard-loop']) {
    const { startGuardLoop } = await import("./guard");
    const intervalStr = positionals[0];
    const intervalMs = intervalStr ? parseInt(intervalStr) * 1000 : undefined;
    await startGuardLoop(intervalMs);
    return;
  }

  // Dashboard: spawn the dashboard server as a bgr-managed process
  if (values.dashboard) {
    const dashboardName = 'bgr-dashboard';
    const homePath = getHomeDir();
    const bgrDir = join(homePath, '.bgr');
    // User can request a specific port via BUN_PORT=XXXX bgrun --dashboard
    // Otherwise Melina picks automatically (3000 → fallback)
    const requestedPort = values.port as string | undefined;

    // Check if dashboard is already running
    const existing = getProcess(dashboardName);
    if (existing && await isProcessRunning(existing.pid)) {
      // The stored PID may be the shell wrapper (cmd.exe), not the actual bun process
      // Try the stored PID first, then traverse the process tree to find the real one
      let existingPorts = await getProcessPorts(existing.pid);
      if (existingPorts.length === 0) {
        const childPid = await findChildPid(existing.pid);
        if (childPid !== existing.pid) {
          existingPorts = await getProcessPorts(childPid);
        }
      }
      const portStr = existingPorts.length > 0 ? `:${existingPorts[0]}` : '(detecting...)';
      announce(
        `Dashboard is already running (PID ${existing.pid})\n\n` +
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
    const { resolve } = require('path');
    const scriptPath = resolve(process.argv[1]);
    const spawnCommand = `bun run ${scriptPath} --_serve`;
    const command = `bgrun --_serve`;
    const stdoutPath = join(bgrDir, `${dashboardName}-out.txt`);
    const stderrPath = join(bgrDir, `${dashboardName}-err.txt`);

    await Bun.write(stdoutPath, '');
    await Bun.write(stderrPath, '');

    // Pass BUN_PORT env var only if user explicitly requested a port
    const spawnEnv = { ...Bun.env };
    if (requestedPort) {
      spawnEnv.BUN_PORT = requestedPort;
    }

    // Resolve the target port: --port flag > BUN_PORT env > default 3000
    const targetPort = parseInt(requestedPort || Bun.env.BUN_PORT || '3000');
    if (!isNaN(targetPort) && targetPort > 0) {
      // Auto-kill whatever occupies the target port so dashboard always reclaims it
      const portFree = await isPortFree(targetPort);
      if (!portFree) {
        console.log(chalk.yellow(`  ⚡ Port ${targetPort} is occupied — reclaiming...`));
        await killProcessOnPort(targetPort);
        const freed = await waitForPortFree(targetPort, 5000);
        if (!freed) {
          console.log(chalk.red(`  ⚠ Could not free port ${targetPort} — dashboard may pick a fallback port`));
        }
      }
    }

    const newProcess = Bun.spawn(getShellCommand(spawnCommand), {
      env: spawnEnv,
      cwd: bgrDir,
      stdout: Bun.file(stdoutPath),
      stderr: Bun.file(stderrPath),
    });

    newProcess.unref();

    // Resolve the actual child PID by traversing the process tree
    // (cmd.exe → bun.exe), then detect which port it bound
    await sleep(2000); // Give the server time to start and bind a port
    const actualPid = await findChildPid(newProcess.pid);

    // Detect the port the server actually bound to
    let actualPort: number | null = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const ports = await getProcessPorts(actualPid);
      if (ports.length > 0) {
        actualPort = ports[0];
        break;
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

  // Guard: spawn the standalone guard as a bgr-managed process
  if (values.guard) {
    const guardName = 'bgr-guard';
    const homePath = getHomeDir();
    const bgrDir = join(homePath, '.bgr');

    // Check if guard is already running
    const existing = getProcess(guardName);
    if (existing && await isProcessRunning(existing.pid)) {
      announce(
        `Guard is already running (PID ${existing.pid})\n\n` +
        `  Use ${chalk.yellow(`bgrun --stop ${guardName}`)} to stop it\n` +
        `  Use ${chalk.yellow(`bgrun --guard --force`)} to restart`,
        'BGR Guard'
      );
      return;
    }

    // Kill existing if force
    if (existing) {
      if (await isProcessRunning(existing.pid)) {
        await terminateProcess(existing.pid);
      }
      await retryDatabaseOperation(() => removeProcessByName(guardName));
    }

    const { resolve } = require('path');
    const scriptPath = resolve(process.argv[1]);
    const spawnCommand = `bun run ${scriptPath} --_guard-loop`;
    const command = `bgrun --_guard-loop`;
    const stdoutPath = join(bgrDir, `${guardName}-out.txt`);
    const stderrPath = join(bgrDir, `${guardName}-err.txt`);

    await Bun.write(stdoutPath, '');
    await Bun.write(stderrPath, '');

    const newProcess = Bun.spawn(getShellCommand(spawnCommand), {
      env: { ...Bun.env },
      cwd: bgrDir,
      stdout: Bun.file(stdoutPath),
      stderr: Bun.file(stderrPath),
    });

    newProcess.unref();
    await sleep(1000);
    const actualPid = await findChildPid(newProcess.pid);

    await retryDatabaseOperation(() =>
      insertProcess({
        pid: actualPid,
        workdir: bgrDir,
        command,
        name: guardName,
        env: 'BGR_KEEP_ALIVE=false', // Guard doesn't guard itself
        configPath: '',
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
      })
    );

    const msg = dedent`
      ${chalk.bold('🛡️  BGR Standalone Guard launched')}
      ${chalk.gray('─'.repeat(40))}

        Monitors: All processes with BGR_KEEP_ALIVE=true
        Also watches: bgr-dashboard (auto-restart if it dies)
        Check interval: 30 seconds
        Backoff: Exponential after 5 rapid crashes

      ${chalk.gray('─'.repeat(40))}
        Process: ${chalk.white(guardName)}  |  PID: ${chalk.white(String(actualPid))}

        ${chalk.yellow(`bgrun ${guardName} --logs`)}    View guard logs
        ${chalk.yellow(`bgrun --stop ${guardName}`)}    Stop the guard
    `;
    announce(msg, 'BGR Guard');
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
  if (values.watch) {
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
        configPath: values.config as string | undefined,
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
  error(err);
});
