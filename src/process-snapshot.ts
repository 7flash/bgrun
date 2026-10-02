import { clearProcessOwnership, type Process } from "./db";
import {
  inspectManagedProcess,
  isProcessRunning,
  resolvePidWithPorts,
} from "./platform";

export type ManagedProcessSnapshot = {
  name: string;
  state: "running" | "stopped";
  pid: number | null;
  ports: number[];
  startedAt: string;
};

export async function inspectManagedProcessSnapshot(
  proc: Process,
): Promise<ManagedProcessSnapshot> {
  const inspection = proc.start_identity
    ? await inspectManagedProcess(
        proc.pid,
        proc.name,
        proc.start_identity,
        proc.command,
      )
    : (await isProcessRunning(proc.pid, proc.command))
      ? "unknown"
      : "dead";

  const running =
    inspection === "alive" ||
    (inspection === "unknown" && !proc.start_identity && proc.pid > 0);

  if (!running) {
    if (inspection === "dead" || inspection === "mismatch") {
      clearProcessOwnership(proc.name, {
        pid: proc.pid,
        startIdentity: proc.start_identity,
      });
    }
    return {
      name: proc.name,
      state: "stopped",
      pid: null,
      ports: [],
      startedAt: proc.timestamp,
    };
  }

  try {
    const resolved = await resolvePidWithPorts(proc.pid);
    return {
      name: proc.name,
      state: "running",
      pid: resolved.pid > 0 ? resolved.pid : proc.pid,
      ports: resolved.ports,
      startedAt: proc.timestamp,
    };
  } catch {
    return {
      name: proc.name,
      state: "running",
      pid: proc.pid,
      ports: [],
      startedAt: proc.timestamp,
    };
  }
}

export function formatShortRuntime(
  startedAt: string,
  now = Date.now(),
): string {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "?";

  const totalMinutes = Math.max(0, Math.floor((now - started) / 60_000));
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}
