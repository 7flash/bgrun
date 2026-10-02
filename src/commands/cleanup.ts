import {
  clearProcessOwnership,
  getProcess,
  removeProcessByName,
  removeProcess,
  getAllProcesses,
  removeAllProcesses,
} from "../db";
import { inspectManagedProcess, terminateProcess } from "../platform";
import {
  parseEnvString,
  acquireProcessOperationLock,
  getWatchedProcessName,
  isInternalProcessName,
} from "../utils";
import { announce, error } from "../logger";
import * as fs from "fs";
import { stopProcessWatcher } from "../watcher";

const BGR_PARENT_NAME_ENV = "BGR_PARENT_NAME";

export function getManagedChildProcesses(parentName: string) {
  return getAllProcesses().filter((proc) => {
    if (proc.name === parentName) return false;
    const env = proc.env ? parseEnvString(proc.env) : {};
    return env[BGR_PARENT_NAME_ENV] === parentName;
  });
}

async function inspectForDestructiveOperation(
  proc: NonNullable<ReturnType<typeof getProcess>>,
) {
  return inspectManagedProcess(
    proc.pid,
    proc.name,
    proc.start_identity,
    proc.command,
  );
}

function clearKnownOwnership(
  proc: NonNullable<ReturnType<typeof getProcess>>,
): void {
  clearProcessOwnership(proc.name, {
    pid: proc.pid,
    startIdentity: proc.start_identity,
  });
}

export async function deleteProcess(name: string): Promise<void> {
  const release = acquireProcessOperationLock(name);
  try {
    const proc = getProcess(name);
    if (!proc) throw new Error(`No process found named '${name}'`);

    const inspection = await inspectForDestructiveOperation(proc);
    if (inspection === "unknown") {
      throw new Error(
        `Cannot prove ownership of PID ${proc.pid} for '${name}'. Refusing to delete a potentially running process.`,
      );
    }
    if (inspection === "alive") {
      await terminateProcess(proc.pid, false, proc.start_identity || undefined);
    }

    if (!isInternalProcessName(name)) {
      await stopProcessWatcher(name);
    }

    for (const path of [proc.stdout_path, proc.stderr_path]) {
      if (!fs.existsSync(path)) continue;
      try {
        fs.unlinkSync(path);
      } catch {}
    }

    removeProcessByName(name);
  } finally {
    release();
  }
}

export async function handleDelete(name: string) {
  const proc = getProcess(name);
  if (!proc) {
    error(`No process found named '${name}'`);
    return;
  }
  const inspection = await inspectForDestructiveOperation(proc);
  const wasRunning = inspection === "alive";
  await deleteProcess(name);
  announce(
    `Process '${name}' has been ${wasRunning ? "stopped and " : ""}deleted`,
    "Process Deleted",
  );
}

export async function handleClean() {
  const processes = getAllProcesses();
  let cleanedCount = 0;
  let deletedLogs = 0;

  for (const proc of processes) {
    const inspection = await inspectForDestructiveOperation(proc);
    if (inspection === "alive" || inspection === "unknown") continue;

    const watched = getWatchedProcessName(proc.name);
    removeProcess(proc.pid);
    cleanedCount++;
    if (watched) continue;

    for (const path of [proc.stdout_path, proc.stderr_path]) {
      if (!fs.existsSync(path)) continue;
      try {
        fs.unlinkSync(path);
        deletedLogs++;
      } catch {}
    }
  }

  if (cleanedCount === 0) {
    announce("No stopped processes found to clean.", "Clean Complete");
  } else {
    announce(
      `Cleaned ${cleanedCount} stopped ${cleanedCount === 1 ? "process" : "processes"} and removed ${deletedLogs} log ${deletedLogs === 1 ? "file" : "files"}.`,
      "Clean Complete",
    );
  }
}

export type StopProcessResult = {
  name: string;
  alreadyStopped: boolean;
  stoppedChildren: number;
};

export async function stopProcess(
  name: string,
  seen: Set<string> = new Set(),
): Promise<StopProcessResult> {
  if (seen.has(name)) {
    return { name, alreadyStopped: true, stoppedChildren: 0 };
  }
  seen.add(name);

  const release = acquireProcessOperationLock(name);
  try {
    const proc = getProcess(name);
    if (!proc) throw new Error(`No process found named '${name}'`);

    const childProcesses = getManagedChildProcesses(name);
    let stoppedChildren = 0;
    for (const child of childProcesses) {
      await stopProcess(child.name, seen);
      stoppedChildren++;
    }

    const inspection = await inspectForDestructiveOperation(proc);
    if (inspection === "dead" || inspection === "mismatch") {
      clearKnownOwnership(proc);
      return { name, alreadyStopped: true, stoppedChildren };
    }
    if (inspection === "unknown") {
      throw new Error(
        `Cannot prove ownership of PID ${proc.pid} for '${name}'. Refusing to terminate it.`,
      );
    }

    await terminateProcess(proc.pid, false, proc.start_identity || undefined);
    clearKnownOwnership(proc);
    return { name, alreadyStopped: false, stoppedChildren };
  } finally {
    release();
  }
}

export async function handleStop(name: string, seen: Set<string> = new Set()) {
  if (!getProcess(name)) {
    error(`No process found named '${name}'`);
    return;
  }
  const result = await stopProcess(name, seen);
  if (result.alreadyStopped) {
    announce(
      `Process '${name}' is already stopped${result.stoppedChildren > 0 ? `; stopped ${result.stoppedChildren} managed child ${result.stoppedChildren === 1 ? "process" : "processes"}` : ""}.`,
      "Process Stop",
    );
    return;
  }
  announce(
    `Process '${name}' has been stopped (kept in registry)${result.stoppedChildren > 0 ? `; stopped ${result.stoppedChildren} managed child ${result.stoppedChildren === 1 ? "process" : "processes"}` : ""}.`,
    "Process Stopped",
  );
}

export async function handleDeleteAll() {
  const processes = getAllProcesses();
  if (processes.length === 0) {
    announce("There are no processes to delete.", "Delete All");
    return;
  }

  let killedCount = 0;
  let unsafeCount = 0;

  for (const proc of processes) {
    if (!isInternalProcessName(proc.name)) {
      await stopProcessWatcher(proc.name);
    }

    const inspection = await inspectForDestructiveOperation(proc);
    if (inspection === "alive") {
      await terminateProcess(proc.pid, true, proc.start_identity || undefined);
      killedCount++;
    } else if (inspection === "unknown") {
      unsafeCount++;
      continue;
    }

    for (const path of [proc.stdout_path, proc.stderr_path]) {
      if (!fs.existsSync(path)) continue;
      try {
        fs.unlinkSync(path);
      } catch {}
    }
  }

  removeAllProcesses();

  const parts = [
    `${processes.length} ${processes.length === 1 ? "process" : "processes"} deleted`,
  ];
  if (killedCount > 0) parts.push(`${killedCount} terminated`);
  if (unsafeCount > 0) {
    parts.push(
      `${unsafeCount} running PID${unsafeCount === 1 ? "" : "s"} left untouched because ownership could not be proven`,
    );
  }

  announce(parts.join(", ") + ".", "Nuke Complete");
}
