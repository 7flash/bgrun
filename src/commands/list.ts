import { getCurrentProcesses } from "../db";
import { parseEnvString, isInternalProcessName } from "../utils";
import { inspectManagedProcessSnapshot } from "../process-snapshot";

type ShowAllOptions = {
  json?: boolean;
  jsonFull?: boolean;
  filter?: string;
};

type ProcessJsonRow = {
  pid: number;
  name: string;
  ports?: number[];
  status: "running" | "stopped";
  statusSource: "pid-fast" | "command-verified";
  healthChecked: boolean;
  commandVerified: boolean;
  parentName: string;
  group: string | null;
  command: string;
  workdir: string;
  directory: string;
  runtime: string;
  timestamp: string;
  env: Record<string, string>;
};

function isPidAliveFast(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getFilteredProcesses(opts?: ShowAllOptions) {
  return getCurrentProcesses().filter((proc) => {
    if (isInternalProcessName(proc.name)) return false;
    if (!opts?.filter) return true;
    const envVars = parseEnvString(proc.env);
    return envVars["BGR_GROUP"] === opts.filter;
  });
}

function parentNameFromEnv(envVars: Record<string, string>): string {
  return String(envVars.BGR_PARENT_NAME ?? envVars.BGRUN_PARENT_NAME ?? "");
}

function formatRuntime(timestamp: string, now = Date.now()): string {
  const startedAt = new Date(timestamp).getTime();
  if (!Number.isFinite(startedAt)) return "?";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) return "<1m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24)
    return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function formatProcessLine(
  snapshot: {
    name: string;
    state: "running" | "stopped";
    pid: number | null;
    ports: number[];
    startedAt: string;
  },
  now = Date.now(),
): string {
  if (snapshot.state === "stopped") {
    return `${snapshot.name}  ○ stopped`;
  }

  const parts = [snapshot.name, "● running"];

  if (snapshot.pid != null) {
    parts.push(`pid ${snapshot.pid}`);
  }

  if (snapshot.ports.length > 0) {
    parts.push(snapshot.ports.map((port) => `:${port}`).join(" "));
  }

  parts.push(formatRuntime(snapshot.startedAt, now));
  return parts.join("  ");
}

function printFastJson(filtered: ReturnType<typeof getFilteredProcesses>) {
  const jsonData: ProcessJsonRow[] = filtered.map((proc) => {
    const envVars = parseEnvString(proc.env);
    const running = isPidAliveFast(proc.pid);
    return {
      pid: proc.pid,
      name: proc.name,
      status: running ? "running" : "stopped",
      statusSource: "pid-fast",
      healthChecked: false,
      commandVerified: false,
      parentName: parentNameFromEnv(envVars),
      group: envVars.BGR_GROUP ?? null,
      command: proc.command,
      workdir: proc.workdir,
      directory: proc.workdir,
      runtime: running ? formatRuntime(proc.timestamp) : "-",
      timestamp: proc.timestamp,
      env: envVars,
    };
  });

  console.log(JSON.stringify(jsonData, null, 2));
}

export async function showAll(opts?: ShowAllOptions) {
  const filtered = getFilteredProcesses(opts);

  if (opts?.json && !opts?.jsonFull) {
    printFastJson(filtered);
    return;
  }

  if (opts?.json) {
    const jsonData: ProcessJsonRow[] = [];

    for (const proc of filtered) {
      const snapshot = await inspectManagedProcessSnapshot(proc);
      const envVars = parseEnvString(proc.env);
      const running = snapshot.state === "running";

      jsonData.push({
        pid: snapshot.pid ?? 0,
        name: proc.name,
        ports: snapshot.ports.length > 0 ? snapshot.ports : undefined,
        status: snapshot.state,
        statusSource: "command-verified",
        healthChecked: true,
        commandVerified: true,
        parentName: parentNameFromEnv(envVars),
        group: envVars.BGR_GROUP ?? null,
        command: proc.command,
        workdir: proc.workdir,
        directory: proc.workdir,
        runtime: running ? formatRuntime(proc.timestamp) : "-",
        timestamp: proc.timestamp,
        env: envVars,
      });
    }

    console.log(JSON.stringify(jsonData, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(opts?.filter ? "no matching processes" : "no processes");
    return;
  }

  for (const proc of filtered) {
    const snapshot = await inspectManagedProcessSnapshot(proc);
    console.log(formatProcessLine(snapshot));
  }
}
