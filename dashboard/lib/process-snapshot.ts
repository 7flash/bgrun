import { $ } from "bun";
import {
  calculateRuntime,
  getAllProcesses,
  getGuardRestartCounts,
  isInternalProcessName,
  parseEnvString,
} from "./runtime";
import {
  getProcessBatchResources,
  resolvePidWithPorts,
} from "../../dist/api.js";

const SUBPROCESS_TIMEOUT_MS = 4_000;
const RESOLVE_TIMEOUT_MS = 2_000;
const HISTORY_SAMPLES = 60;

type ResourceSample = { memory: number; cpu: number };
type ResourceHistory = {
  memory: number[];
  cpu: number[];
  lastCpuTime: number;
  lastCheck: number;
};

type StoredProcess = ReturnType<typeof getAllProcesses>[number];

export type ProcessSnapshot = {
  name: string;
  command: string;
  directory: string;
  pid: number;
  running: boolean;
  port: number | null;
  ports: number[];
  memory: number;
  cpu: number;
  memoryHistory: number[];
  cpuHistory: number[];
  group: string | null;
  runtime: string;
  timestamp: string;
  env: string;
  configPath: string;
  stdoutPath: string;
  stderrPath: string;
  guardRestarts: number;
};

const globalState = globalThis as typeof globalThis & {
  __bgrResourceHistory?: Map<string, ResourceHistory>;
};

const history =
  globalState.__bgrResourceHistory ??
  (globalState.__bgrResourceHistory = new Map<string, ResourceHistory>());

async function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  ms = SUBPROCESS_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getRunningPids(pids: number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set();

  const running = new Set<number>();
  if (process.platform === "win32") {
    const unresolved: number[] = [];
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        running.add(pid);
      } catch {
        unresolved.push(pid);
      }
    }

    if (unresolved.length === 0) return running;
    const unresolvedSet = new Set(unresolved);
    const result = await $`tasklist /FO CSV /NH`.nothrow().quiet().text();
    for (const line of result.split("\n")) {
      const match = line.match(/"[^"]*","(\d+)"/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (unresolvedSet.has(pid)) running.add(pid);
    }
    return running;
  }

  const result = await $`ps -p ${pids.join(",")} -o pid=`
    .nothrow()
    .quiet()
    .text();
  for (const line of result.trim().split("\n")) {
    const pid = Number(line.trim());
    if (Number.isInteger(pid) && pid > 0) running.add(pid);
  }
  return running;
}

async function getPortsByPid(pids: number[]): Promise<Map<number, number[]>> {
  const portsByPid = new Map<number, number[]>();
  if (pids.length === 0) return portsByPid;
  const pidSet = new Set(pids);

  if (process.platform === "win32") {
    const result = await $`netstat -ano`.nothrow().quiet().text();
    for (const line of result.split("\n")) {
      const match = line.match(
        /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/,
      );
      if (!match) continue;
      addPort(portsByPid, pidSet, Number(match[2]), Number(match[1]));
    }
    return portsByPid;
  }

  const result = await $`ss -tlnp`.nothrow().quiet().text();
  for (const line of result.split("\n")) {
    const pidMatch = line.match(/pid=(\d+)/);
    const portMatch = line.match(/:(\d+)\s+/);
    if (!pidMatch || !portMatch) continue;
    addPort(portsByPid, pidSet, Number(pidMatch[1]), Number(portMatch[1]));
  }
  return portsByPid;
}

function addPort(
  target: Map<number, number[]>,
  allowedPids: Set<number>,
  pid: number,
  port: number,
): void {
  if (!allowedPids.has(pid) || !Number.isInteger(port) || port <= 0) return;
  const ports = target.get(pid) ?? [];
  if (!ports.includes(port)) ports.push(port);
  target.set(pid, ports);
}

function getLatestProcesses(): StoredProcess[] {
  const latest = new Map<string, StoredProcess>();
  for (const proc of getAllProcesses()) {
    if (isInternalProcessName(proc.name)) continue;
    const current = latest.get(proc.name);
    if (
      !current ||
      proc.timestamp > current.timestamp ||
      (proc.timestamp === current.timestamp && proc.id > current.id)
    ) {
      latest.set(proc.name, proc);
    }
  }
  return [...latest.values()];
}

function getHistory(name: string): ResourceHistory {
  const existing = history.get(name);
  if (existing) return existing;
  const created: ResourceHistory = {
    memory: [],
    cpu: [],
    lastCpuTime: 0,
    lastCheck: 0,
  };
  history.set(name, created);
  return created;
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > HISTORY_SAMPLES) samples.shift();
}

function updateResourceHistory(
  name: string,
  running: boolean,
  resource: ResourceSample,
  now: number,
): { memoryHistory: number[]; cpuHistory: number[]; cpuPercent: number } {
  const item = getHistory(name);
  let cpuPercent = 0;

  if (running) {
    if (process.platform === "win32") {
      if (item.lastCheck > 0 && item.lastCpuTime > 0) {
        const elapsedSeconds = (now - item.lastCheck) / 1000;
        const cpuSeconds = resource.cpu - item.lastCpuTime;
        if (elapsedSeconds > 0 && cpuSeconds >= 0) {
          cpuPercent = (cpuSeconds / elapsedSeconds) * 100;
        }
      }
      item.lastCpuTime = resource.cpu;
    } else {
      cpuPercent = resource.cpu;
    }

    pushSample(item.memory, resource.memory);
    pushSample(item.cpu, cpuPercent);
    item.lastCheck = now;
  } else {
    if (item.memory.at(-1) !== 0 && item.memory.length > 0) {
      pushSample(item.memory, 0);
      pushSample(item.cpu, 0);
    }
    item.lastCheck = 0;
    item.lastCpuTime = 0;
  }

  return {
    memoryHistory: [...item.memory],
    cpuHistory: [...item.cpu],
    cpuPercent,
  };
}

function pruneHistory(activeNames: Set<string>): void {
  for (const name of history.keys()) {
    if (!activeNames.has(name)) history.delete(name);
  }
}

export async function fetchProcessSnapshots(): Promise<ProcessSnapshot[]> {
  const processes = getLatestProcesses();
  const pids = processes.map((proc) => proc.pid).filter((pid) => pid > 0);
  const guardRestartCounts = getGuardRestartCounts();

  const [runningPids, portsByPid, resourcesByPid] = await Promise.all([
    withTimeout(getRunningPids(pids), new Set<number>()),
    withTimeout(getPortsByPid(pids), new Map<number, number[]>()),
    withTimeout(
      getProcessBatchResources(pids),
      new Map<number, ResourceSample>(),
    ),
  ]);

  const displayPidByName = new Map<string, number>();
  await Promise.all(
    processes.map(async (proc) => {
      if (!runningPids.has(proc.pid)) return;
      if ((portsByPid.get(proc.pid)?.length ?? 0) > 0) return;

      const resolved = await withTimeout(
        resolvePidWithPorts(proc.pid),
        { pid: proc.pid, ports: [] },
        RESOLVE_TIMEOUT_MS,
      );
      if (resolved.pid === proc.pid || resolved.ports.length === 0) return;

      displayPidByName.set(proc.name, resolved.pid);
      runningPids.add(resolved.pid);
      portsByPid.set(resolved.pid, resolved.ports);

      const refreshed = await withTimeout(
        getProcessBatchResources([resolved.pid]),
        new Map<number, ResourceSample>(),
        RESOLVE_TIMEOUT_MS,
      );
      const resource = refreshed.get(resolved.pid);
      if (resource) resourcesByPid.set(resolved.pid, resource);
    }),
  );

  const now = Date.now();
  const activeNames = new Set(processes.map((proc) => proc.name));
  pruneHistory(activeNames);

  return processes.map((proc) => {
    const pid = displayPidByName.get(proc.name) ?? proc.pid;
    const running = runningPids.has(proc.pid) || runningPids.has(pid);
    const ports = running
      ? (portsByPid.get(pid) ?? portsByPid.get(proc.pid) ?? [])
      : [];
    const resource = running
      ? (resourcesByPid.get(pid) ??
        resourcesByPid.get(proc.pid) ?? { memory: 0, cpu: 0 })
      : { memory: 0, cpu: 0 };
    const resourceHistory = updateResourceHistory(
      proc.name,
      running,
      resource,
      now,
    );
    const env = parseEnvString(proc.env || "");

    return {
      name: proc.name,
      command: proc.command,
      directory: proc.workdir,
      pid,
      running,
      port: ports[0] ?? null,
      ports,
      memory: resource.memory,
      cpu: resourceHistory.cpuPercent,
      memoryHistory: resourceHistory.memoryHistory,
      cpuHistory: resourceHistory.cpuHistory,
      group: env.BGR_GROUP ?? null,
      runtime: calculateRuntime(proc.timestamp),
      timestamp: proc.timestamp,
      env: proc.env || "",
      configPath: proc.configPath || "",
      stdoutPath: proc.stdout_path || "",
      stderrPath: proc.stderr_path || "",
      guardRestarts: guardRestartCounts.get(proc.name) || 0,
    } satisfies ProcessSnapshot;
  });
}
