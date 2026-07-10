import type { Process } from "./db";
import { getAllProcesses } from "./db";
import { parseEnvString } from "./utils";

function getParentName(proc: Process): string {
  const env = proc.env ? parseEnvString(proc.env) : {};
  return String(env.BGR_PARENT_NAME ?? env.BGRUN_PARENT_NAME ?? "");
}

/**
 * Return bgrun-managed processes that were started by a managed parent.
 *
 * The parent/child link is stored in the child process env, so it survives
 * process restarts and can be inspected by both CLI and SDK.
 */
export function getManagedChildProcesses(parentName: string): Process[] {
  if (!parentName) return [];
  return getAllProcesses().filter((proc) => getParentName(proc) === parentName);
}
