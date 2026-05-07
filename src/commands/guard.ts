import { addHistoryEntry, getProcess, retryDatabaseOperation, updateProcessEnv } from "../db";
import { announce, error } from "../logger";
import { ensureProcessWatcher, stopProcessWatcher } from "../watcher";
import { isInternalProcessName, parseEnvString, stringifyEnvString } from "../utils";

export async function handleGuardToggle(targetName: string | undefined, enabled: boolean) {
  if (!targetName) {
    error(`Please provide a process name. Example: bunx bgrun myapp ${enabled ? '--guard' : '--guard-off'}`);
  }

  if (isInternalProcessName(targetName)) {
    error(`'${targetName}' is an internal bgrun process.`);
  }

  const proc = getProcess(targetName);
  if (!proc) {
    error(`Process '${targetName}' not found.`);
  }

  const env = parseEnvString(proc.env || "");
  const alreadyGuarded = env.BGR_KEEP_ALIVE === "true";

  if (enabled) {
    env.BGR_KEEP_ALIVE = "true";
    await retryDatabaseOperation(() => updateProcessEnv(targetName, stringifyEnvString(env)));
    await ensureProcessWatcher(targetName);
    addHistoryEntry(targetName, "guard_on", proc.pid);

    announce(
      alreadyGuarded
        ? `Guard is already active for '${targetName}'`
        : `🛡️ Guard enabled for '${targetName}'`,
      "Process Guard",
    );
    return;
  }

  delete env.BGR_KEEP_ALIVE;
  await retryDatabaseOperation(() => updateProcessEnv(targetName, stringifyEnvString(env)));
  await stopProcessWatcher(targetName);
  addHistoryEntry(targetName, "guard_off", proc.pid);

  announce(
    alreadyGuarded
      ? `🛑 Guard disabled for '${targetName}'`
      : `Guard is already off for '${targetName}'`,
    "Process Guard",
  );
}
