import { join } from "path";
import { getBgrHome, getDatabasePath } from "./paths";
import {
  addHistoryEntry,
  getHistoryByEvent,
  getProcess,
  getRecentHistoryByEvents,
  insertProcess,
  removeProcessByName,
  retryDatabaseOperation,
  type Process,
} from "./db";
import {
  findChildPid,
  getHomeDir,
  getProcessMemory,
  getShellCommand,
  inspectManagedProcess,
  isManagedProcessRunning,
  isProcessRunning,
  psExec,
  terminateProcess,
} from "./platform";
import { runProcess } from "./commands/run";
import { getProcessBirthId } from "./process-identity";
import { shellQuoteArg } from "./cli-helpers";
import { getErrorMessage } from "./error-utils";
import {
  historyRowToGuardEvent,
  type GuardRestartReason,
} from "./history-events";
import {
  DEFAULT_GUARD_INTERVAL_MS,
  GUARD_STABILITY_WINDOW_MS,
  MEMORY_LIMIT_HITS_REQUIRED,
  getGuardBackoffMs,
  parseMemoryLimitMb,
} from "./guard-policy";
import {
  acquireProcessOperationLock,
  getWatcherProcessName,
  isInternalProcessName,
  isProcessOperationLocked,
  parseEnvString,
  stringifyEnvString,
} from "./utils";

type WatcherState = {
  restartCount: number;
  nextRestartAt: number;
  lastSeenAliveAt: number;
  memoryLimitHits: number;
};

type GuardInspection = {
  alive: boolean;
  reason: GuardRestartReason | null;
  memoryBytes: number;
  memoryLimitMb: number;
};

function getWatcherLogPaths(watcherName: string) {
  const homePath = getBgrHome();
  return {
    stdoutPath: join(homePath, `${watcherName}-out.txt`),
    stderrPath: join(homePath, `${watcherName}-err.txt`),
  };
}

async function findDetachedWatcherPid(
  targetName: string,
): Promise<number | null> {
  if (process.platform !== "win32") return null;

  const escaped = targetName.replace(/'/g, "''");
  const result = await psExec(
    `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | Where-Object { $_.CommandLine -like '*--_watch-process*' -and $_.CommandLine -like '*${escaped}*' } | Sort-Object -Property CreationDate -Descending | Select-Object -First 1 -ExpandProperty ProcessId`,
    4000,
  );
  const pid = parseInt(result.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function getInternalWatcherCommand(targetName: string): {
  storedCommand: string;
  spawnCommand: string;
} {
  const quotedTarget = shellQuoteArg(targetName);
  const command = `bunx bgrun --_watch-process ${quotedTarget}`;
  return { storedCommand: command, spawnCommand: command };
}

async function spawnWatcherProcess(
  targetName: string,
  watcherName: string,
): Promise<number> {
  const { stdoutPath, stderrPath } = getWatcherLogPaths(watcherName);
  await Promise.all([Bun.write(stdoutPath, ""), Bun.write(stderrPath, "")]);

  const { storedCommand, spawnCommand } = getInternalWatcherCommand(targetName);
  const newProcess = Bun.spawn(getShellCommand(spawnCommand), {
    env: {
      ...Bun.env,
      BGRUN_HOME: getBgrHome(),
      BGRUN_DB: getDatabasePath(),
      BGR_STDOUT: stdoutPath,
      BGR_STDERR: stderrPath,
    },
    cwd: getHomeDir(),
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  } as any);

  newProcess.unref();
  await Bun.sleep(1_000);

  let actualPid = await findChildPid(newProcess.pid);
  if (!(await isProcessRunning(actualPid, storedCommand))) {
    actualPid = (await findDetachedWatcherPid(targetName)) ?? 0;
  }

  if (actualPid <= 0 || !(await isProcessRunning(actualPid, storedCommand))) {
    throw new Error(`Guard for "${targetName}" failed to stay running`);
  }

  const startIdentity = getProcessBirthId(actualPid);
  await retryDatabaseOperation(() =>
    insertProcess({
      pid: actualPid,
      workdir: getHomeDir(),
      command: storedCommand,
      name: watcherName,
      env: stringifyEnvString({
        BGR_KEEP_ALIVE: "false",
        BGR_WATCH_TARGET: targetName,
      }),
      configPath: "",
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      start_identity: startIdentity,
    }),
  );

  return actualPid;
}

export async function ensureProcessWatcher(targetName: string): Promise<void> {
  if (!targetName || isInternalProcessName(targetName)) return;

  const proc = getProcess(targetName);
  if (!proc) return;

  const env = parseEnvString(proc.env || "");
  if (env.BGR_KEEP_ALIVE !== "true") {
    await stopProcessWatcher(targetName);
    return;
  }

  const watcherName = getWatcherProcessName(targetName);
  const existingWatcher = getProcess(watcherName);
  if (
    existingWatcher &&
    (await isManagedProcessRunning(
      existingWatcher.pid,
      existingWatcher.name,
      existingWatcher.command,
      existingWatcher.start_identity,
    ))
  ) {
    return;
  }

  if (existingWatcher) {
    await retryDatabaseOperation(() => removeProcessByName(watcherName));
  }

  await spawnWatcherProcess(targetName, watcherName);
}

export async function stopProcessWatcher(targetName: string): Promise<void> {
  const watcherName = getWatcherProcessName(targetName);
  const watcherProc = getProcess(watcherName);
  if (!watcherProc) return;

  const inspection = await inspectManagedProcess(
    watcherProc.pid,
    watcherProc.name,
    watcherProc.start_identity,
    watcherProc.command,
  );
  if (inspection === "alive") {
    await terminateProcess(
      watcherProc.pid,
      true,
      watcherProc.start_identity || undefined,
    );
  } else if (inspection === "unknown") {
    throw new Error(
      `Cannot prove ownership of watcher PID ${watcherProc.pid} for '${targetName}'`,
    );
  }

  await retryDatabaseOperation(() => removeProcessByName(watcherName));
}

export async function syncProcessWatcher(
  targetName: string,
  env: Record<string, string>,
): Promise<void> {
  if (!targetName || isInternalProcessName(targetName)) return;

  if (env.BGR_KEEP_ALIVE === "true") {
    await ensureProcessWatcher(targetName);
  } else {
    await stopProcessWatcher(targetName);
  }
}

function newWatcherState(): WatcherState {
  return {
    restartCount: 0,
    nextRestartAt: 0,
    lastSeenAliveAt: 0,
    memoryLimitHits: 0,
  };
}

function noteStableProcess(state: WatcherState, now: number): void {
  if (state.restartCount <= 0) return;

  if (!state.lastSeenAliveAt) {
    state.lastSeenAliveAt = now;
    return;
  }

  if (now - state.lastSeenAliveAt < GUARD_STABILITY_WINDOW_MS) return;

  state.restartCount = 0;
  state.nextRestartAt = 0;
  state.lastSeenAliveAt = 0;
}

async function inspectTarget(
  proc: Process,
  env: Record<string, string>,
  state: WatcherState,
): Promise<GuardInspection> {
  const alive = await isManagedProcessRunning(
    proc.pid,
    proc.name,
    proc.command,
    proc.start_identity,
  );
  if (!alive) {
    state.memoryLimitHits = 0;
    return { alive: false, reason: "crash", memoryBytes: 0, memoryLimitMb: 0 };
  }

  const memoryLimitMb = parseMemoryLimitMb(env);
  const memoryRestartEnabled =
    memoryLimitMb > 0 && env.BGR_MEMORY_RESTART !== "false";

  if (!memoryRestartEnabled) {
    state.memoryLimitHits = 0;
    return { alive: true, reason: null, memoryBytes: 0, memoryLimitMb };
  }

  const memoryBytes = await getProcessMemory(proc.pid);
  if (memoryBytes > memoryLimitMb * 1024 * 1024) {
    state.memoryLimitHits++;
  } else {
    state.memoryLimitHits = 0;
  }

  return {
    alive: true,
    reason:
      state.memoryLimitHits >= MEMORY_LIMIT_HITS_REQUIRED ? "memory" : null,
    memoryBytes,
    memoryLimitMb,
  };
}

async function restartTarget(
  targetName: string,
  watcherName: string,
  proc: Process,
  inspection: GuardInspection,
  state: WatcherState,
): Promise<void> {
  const now = Date.now();
  if (now < state.nextRestartAt || !inspection.reason) return;

  state.restartCount++;
  const backoffMs = getGuardBackoffMs(state.restartCount);
  state.nextRestartAt = backoffMs > 0 ? now + backoffMs : 0;

  try {
    await runProcess({
      action: "run",
      name: targetName,
      force: true,
      remoteName: "",
    });

    state.memoryLimitHits = 0;
    state.lastSeenAliveAt = 0;
    addHistoryEntry(targetName, "guard_restart", proc.pid, {
      by: watcherName,
      count: state.restartCount,
      backoffMs,
      reason: inspection.reason,
      memoryBytes: inspection.memoryBytes || undefined,
      memoryLimitMb: inspection.memoryLimitMb || undefined,
    });
  } catch (error: unknown) {
    addHistoryEntry(targetName, "guard_restart_failed", proc.pid, {
      by: watcherName,
      count: state.restartCount,
      backoffMs,
      reason: inspection.reason,
      error: getErrorMessage(error),
    });
    console.error(
      `[watcher] restart failed for "${targetName}": ${getErrorMessage(error)}`,
    );
  }
}

async function cleanupWatcher(targetName: string): Promise<void> {
  const watcherName = getWatcherProcessName(targetName);
  await retryDatabaseOperation(() => removeProcessByName(watcherName));
}

export async function startProcessWatcher(
  targetName: string,
  intervalMs: number = DEFAULT_GUARD_INTERVAL_MS,
): Promise<void> {
  const watcherName = getWatcherProcessName(targetName);
  const releaseWatcherLock = acquireProcessOperationLock(watcherName);
  const state = newWatcherState();

  try {
    console.log(
      `[watcher] watching "${targetName}" every ${Math.round(intervalMs / 1000)}s`,
    );

    while (true) {
      const proc = getProcess(targetName);
      if (!proc) break;

      const env = parseEnvString(proc.env || "");
      if (env.BGR_KEEP_ALIVE !== "true") break;

      // PID 0 represents an intentional stop; an explicit user action must not
      // be undone by the guard. Operation locks also suppress restart races.
      if (proc.pid <= 0 || isProcessOperationLocked(targetName)) {
        await Bun.sleep(intervalMs);
        continue;
      }

      const inspection = await inspectTarget(proc, env, state);
      if (inspection.reason) {
        await restartTarget(targetName, watcherName, proc, inspection, state);
      } else if (inspection.alive) {
        noteStableProcess(state, Date.now());
      }

      await Bun.sleep(intervalMs);
    }
  } finally {
    releaseWatcherLock();
    await cleanupWatcher(targetName);
  }
}

export function getGuardRestartCounts() {
  const counts = new Map<string, number>();
  for (const entry of getHistoryByEvent("guard_restart")) {
    counts.set(entry.process_name, (counts.get(entry.process_name) || 0) + 1);
  }
  return counts;
}

export function getRecentGuardEvents(limit = 100) {
  const rows = getRecentHistoryByEvents(
    ["guard_restart", "guard_restart_failed"],
    limit,
  );

  return rows.map(historyRowToGuardEvent);
}
