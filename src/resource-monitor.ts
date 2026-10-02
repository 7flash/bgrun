import { getCurrentProcesses } from "./db";
import { parseMemoryLimitMb } from "./guard-policy";
import {
  getListeningPortsByPid,
  getProcessBatchResources,
  getSystemProcessResources,
  type SystemProcessResource,
} from "./platform";
import { isInternalProcessName, parseEnvString } from "./utils";

export type ResourceSort = "memory" | "cpu" | "name";

export type ResourceSnapshotRow = {
  name: string;
  pid: number;
  cpu: number;
  memory: number;
  ports: number[];
  running: boolean;
  guarded: boolean;
  memoryLimitMb: number;
  managed: boolean;
  command: string;
};

export type ResourceSnapshotOptions = {
  filter?: string;
  portsOnly?: boolean;
  sort?: ResourceSort;
  limit?: number;
};

function processGroup(env: Record<string, string>): string {
  return env.BGR_GROUP || "";
}

export function sortResourceRows(
  rows: ResourceSnapshotRow[],
  sort: ResourceSort = "memory",
): ResourceSnapshotRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "cpu") {
      return (
        b.cpu - a.cpu || b.memory - a.memory || a.name.localeCompare(b.name)
      );
    }
    if (sort === "name") return a.name.localeCompare(b.name);
    return b.memory - a.memory || b.cpu - a.cpu || a.name.localeCompare(b.name);
  });
}

function finalizeRows(
  rows: ResourceSnapshotRow[],
  options: ResourceSnapshotOptions,
): ResourceSnapshotRow[] {
  const filtered = options.portsOnly
    ? rows.filter((row) => row.ports.length > 0)
    : rows;
  const sorted = sortResourceRows(filtered, options.sort);
  const limit = Math.max(0, options.limit || 0);
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

export async function sampleManagedResources(
  options: ResourceSnapshotOptions = {},
): Promise<ResourceSnapshotRow[]> {
  const processes = getCurrentProcesses().filter((proc) => {
    if (isInternalProcessName(proc.name)) return false;
    if (!options.filter) return true;
    return processGroup(parseEnvString(proc.env || "")) === options.filter;
  });
  const pids = processes
    .map((proc) => proc.pid)
    .filter((pid) => Number.isInteger(pid) && pid > 0);

  const [resources, portsByPid] = await Promise.all([
    getProcessBatchResources(pids),
    getListeningPortsByPid(pids),
  ]);

  const rows = processes.map<ResourceSnapshotRow>((proc) => {
    const env = parseEnvString(proc.env || "");
    const resource = resources.get(proc.pid);
    return {
      name: proc.name,
      pid: proc.pid,
      cpu: resource?.cpu || 0,
      memory: resource?.memory || 0,
      ports: portsByPid.get(proc.pid) || [],
      running: resource !== undefined,
      guarded: env.BGR_KEEP_ALIVE === "true",
      memoryLimitMb: parseMemoryLimitMb(env),
      managed: true,
      command: proc.command,
    };
  });

  return finalizeRows(rows, options);
}

function findManagedNameByPid(): Map<
  number,
  { name: string; guarded: boolean; memoryLimitMb: number }
> {
  const byPid = new Map<
    number,
    { name: string; guarded: boolean; memoryLimitMb: number }
  >();
  for (const proc of getCurrentProcesses()) {
    if (proc.pid <= 0 || isInternalProcessName(proc.name)) continue;
    const env = parseEnvString(proc.env || "");
    byPid.set(proc.pid, {
      name: proc.name,
      guarded: env.BGR_KEEP_ALIVE === "true",
      memoryLimitMb: parseMemoryLimitMb(env),
    });
  }
  return byPid;
}

function systemRow(
  proc: SystemProcessResource,
  ports: number[],
  managedByPid: ReturnType<typeof findManagedNameByPid>,
): ResourceSnapshotRow {
  const managed = managedByPid.get(proc.pid);
  return {
    name: managed?.name || proc.executable || `pid-${proc.pid}`,
    pid: proc.pid,
    cpu: proc.cpu,
    memory: proc.memory,
    ports,
    running: true,
    guarded: managed?.guarded || false,
    memoryLimitMb: managed?.memoryLimitMb || 0,
    managed: Boolean(managed),
    command: proc.command,
  };
}

export async function sampleSystemResources(
  options: ResourceSnapshotOptions = {},
): Promise<ResourceSnapshotRow[]> {
  const [processes, portsByPid] = await Promise.all([
    getSystemProcessResources(),
    getListeningPortsByPid(),
  ]);
  const managedByPid = findManagedNameByPid();
  const rows = processes.map((proc) =>
    systemRow(proc, portsByPid.get(proc.pid) || [], managedByPid),
  );
  return finalizeRows(rows, options);
}
