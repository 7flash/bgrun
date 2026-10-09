import { spawnProcess } from "./process-spawn";
/**
 * Cross-platform utility functions for BGR
 * Provides Windows and Unix compatible process management
 */

import * as fs from "fs";
import * as os from "os";
import { join } from "path";
import { $ } from "bun";
import { getProcessBirthId } from "./process-identity";

async function processOutput(argv: string[]): Promise<string> {
  const proc = await spawnProcess(argv, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return stdout;
}

// Simple LRU cache for process liveness checks to avoid repeated PowerShell queries
const isRunningCache = new Map<string, { alive: boolean; checkedAt: number }>();
const CACHE_TTL = 500; // 500ms TTL

function getRunningCacheKey(pid: number, command?: string): string {
  return `${pid}:${command?.trim().toLowerCase() || ""}`;
}

export function clearProcessRunningCache(pid?: number): void {
  if (pid === undefined) {
    isRunningCache.clear();
    return;
  }

  const prefix = `${pid}:`;
  for (const key of isRunningCache.keys()) {
    if (key.startsWith(prefix)) {
      isRunningCache.delete(key);
    }
  }
}

function normalizeCommandText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const COMMAND_MATCH_IGNORED_TOKENS = new Set([
  "bun",
  "bunx",
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "deno",
  "python",
  "python3",
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "bash",
  "zsh",
  "fish",
  "run",
  "x",
  "exec",
  "start",
  "dev",
  "test",
  "-c",
  "/c",
  "/d",
  "/s",
]);

function splitCommandTokens(value: string): string[] {
  return normalizeCommandText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function basenameToken(token: string): string {
  const normalized = token.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

function stripTokenDecorations(token: string): string {
  return token
    .replace(/^[=,:;()[\]{}<>]+/, "")
    .replace(/[=,:;()[\]{}<>]+$/, "");
}

function isStrongCommandToken(token: string): boolean {
  return (
    /\.(ts|tsx|js|jsx|mjs|cjs|json|toml|py|rb|go|rs|php|sh|ps1)$/i.test(
      token,
    ) ||
    token.includes("/") ||
    token.includes("\\")
  );
}

function getCommandMatchTokens(command: string): {
  strong: string[];
  weak: string[];
} {
  const strong = new Set<string>();
  const weak = new Set<string>();

  for (const rawToken of splitCommandTokens(command)) {
    const token = stripTokenDecorations(rawToken);
    if (!token || token.startsWith("-") || token.includes("=")) continue;

    const base = basenameToken(token);
    const normalizedBase = stripTokenDecorations(base);
    const lowerBase = normalizedBase.toLowerCase();

    if (
      COMMAND_MATCH_IGNORED_TOKENS.has(token) ||
      COMMAND_MATCH_IGNORED_TOKENS.has(lowerBase)
    ) {
      continue;
    }

    if (isStrongCommandToken(token)) {
      strong.add(token);
      if (normalizedBase && normalizedBase !== token)
        strong.add(normalizedBase);
      continue;
    }

    if (lowerBase.length >= 4) {
      weak.add(lowerBase);
    }
  }

  return {
    strong: [...strong].filter((token) => token.length >= 3),
    weak: [...weak].filter((token) => token.length >= 4),
  };
}

export function commandLineMatchesExpectedCommand(
  actualCommandLine: string,
  expectedCommand: string,
): boolean {
  const actual = normalizeCommandText(actualCommandLine);
  const expected = normalizeCommandText(expectedCommand);

  if (!actual || !expected) return false;
  if (actual.includes(expected)) return true;

  const tokens = getCommandMatchTokens(expectedCommand);
  if (tokens.strong.length > 0) {
    return tokens.strong.some((token) =>
      actual.includes(normalizeCommandText(token)),
    );
  }

  if (tokens.weak.length > 0) {
    const matches = tokens.weak.filter((token) =>
      actual.includes(normalizeCommandText(token)),
    ).length;
    return matches >= Math.min(tokens.weak.length, 2);
  }

  // If there are no meaningful tokens, the command is too generic to prove a match.
  // In that case the caller should rely on PID existence only.
  return true;
}

async function getProcessCommandLine(pid: number): Promise<string> {
  try {
    if (isWindows()) {
      const escapedPid = Math.trunc(pid);
      return await psExec(
        `Get-CimInstance Win32_Process -Filter "ProcessId=${escapedPid}" | Select-Object -ExpandProperty CommandLine`,
        3000,
      );
    }

    return (await $`ps -p ${pid} -o args=`.nothrow().quiet().text()).trim();
  } catch {
    return "";
  }
}

/**
 * Execute a PowerShell command with -NoProfile asynchronously with timeout.
 * Returns stdout as string, or empty string on error.
 *
 * Uses asynchronous execution to prevent deadlocks on Windows that occur
 * with Bun.spawnSync when multiple processes run simultaneously.
 */
export async function psExec(
  command: string,
  timeoutMs: number = 3000,
): Promise<string> {
  try {
    // Use -Command instead of -File to avoid temp file overhead
    const proc = await spawnProcess(
      [
        "powershell",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      },
    );

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          // Process may already have exited.
        }
        reject(new Error("PowerShell command timed out"));
      }, timeoutMs);
    }) as Promise<string>;

    const resultPromise = new Promise<string>(async (resolve, reject) => {
      try {
        const stdoutPromise = proc.stdout
          ? new Response(proc.stdout).text()
          : Promise.resolve("");
        const stderrPromise = proc.stderr
          ? new Response(proc.stderr).text()
          : Promise.resolve("");
        const exitCode = await proc.exited;
        const stdout = await stdoutPromise;
        const stderr = await stderrPromise;
        if (exitCode === 0) {
          resolve(stdout);
        } else {
          resolve(stderr || ""); // Return stderr on failure for easier debugging
        }
      } catch (error) {
        reject(error);
      }
    });

    // Wait for either the process to complete or the timeout. Always clear the
    // timer; on timeout the spawned PowerShell process is terminated above.
    try {
      const result = await Promise.race([resultPromise, timeoutPromise]);
      return result.trim();
    } catch {
      return "";
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  } catch {
    return "";
  }
}

/** Detect if running on Windows - use function to prevent bundler tree-shaking */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/**
 * Get the user's home directory cross-platform
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Check if a process with the given PID is running
 * For Docker containers, checks container status instead of PID
 */
export async function isProcessRunning(
  pid: number,
  command?: string,
): Promise<boolean> {
  if (pid <= 0) return false;

  const cacheKey = getRunningCacheKey(pid, command);
  const cached = isRunningCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL) {
    return cached.alive;
  }

  try {
    if (
      command &&
      (command.includes("docker run") ||
        command.includes("docker-compose up") ||
        command.includes("docker compose up"))
    ) {
      const alive = await isDockerContainerRunning(command);
      isRunningCache.set(cacheKey, { alive, checkedAt: Date.now() });
      return alive;
    }

    let alive = false;
    if (isWindows()) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        const output = await psExec(
          `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`,
        );
        alive = output === String(pid);
      }
    } else {
      const result = await $`ps -p ${pid}`.nothrow().text();
      alive = result.includes(`${pid}`);
    }

    if (!alive) {
      isRunningCache.set(cacheKey, { alive: false, checkedAt: Date.now() });
      return false;
    }

    if (command?.trim()) {
      const actualCommandLine = await getProcessCommandLine(pid);
      if (actualCommandLine.trim()) {
        alive = commandLineMatchesExpectedCommand(actualCommandLine, command);
      }
    }

    isRunningCache.set(cacheKey, { alive, checkedAt: Date.now() });
    return alive;
  } catch {
    isRunningCache.set(cacheKey, { alive: false, checkedAt: Date.now() });
    return false;
  }
}

export type ManagedProcessInspection =
  "alive" | "dead" | "unknown" | "mismatch";

export async function inspectManagedProcess(
  pid: number,
  processName: string,
  startIdentity: string,
  command?: string,
): Promise<ManagedProcessInspection> {
  if (!Number.isInteger(pid) || pid <= 0) return "dead";
  const running = await isProcessRunning(pid, command);
  if (!running) return "dead";
  if (
    command &&
    (command.includes("docker run") ||
      command.includes("docker-compose up") ||
      command.includes("docker compose up"))
  ) {
    return "alive";
  }
  if (!startIdentity) return "unknown";

  const currentIdentity = getProcessBirthId(pid);
  if (!currentIdentity) return "unknown";
  if (currentIdentity !== startIdentity) return "mismatch";
  if (isWindows()) return "alive";

  try {
    const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
    return environ.includes(`BGR_PROCESS_NAME=${processName}\0`)
      ? "alive"
      : "mismatch";
  } catch {
    return "unknown";
  }
}

export async function isManagedProcessRunning(
  pid: number,
  processName: string,
  command?: string,
  startIdentity?: string,
): Promise<boolean> {
  if (startIdentity) {
    return (
      (await inspectManagedProcess(
        pid,
        processName,
        startIdentity,
        command,
      )) === "alive"
    );
  }
  if (!(await isProcessRunning(pid, command))) return false;
  if (isWindows()) return true;

  try {
    const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
    return environ.includes(`BGR_PROCESS_NAME=${processName}\0`);
  } catch {
    return false;
  }
}

/**
 * Check if a Docker container from a command is running
 */
async function isDockerContainerRunning(command: string): Promise<boolean> {
  try {
    // Extract container name from --name flag
    const nameMatch = command.match(/--name\s+["']?(\S+?)["']?(?:\s|$)/);
    if (nameMatch) {
      const containerName = nameMatch[1];
      const result = await processOutput([
        "docker",
        "inspect",
        "-f",
        "{{.State.Running}}",
        containerName,
      ]);
      return result.trim() === "true";
    }

    // If no --name, try to find running containers that match the image
    // Extract image name (last argument before -d or after -d)
    const imageMatch = command.match(/docker\s+run\s+.*?(?:-d\s+)?(\S+)\s*$/);
    if (imageMatch) {
      const imageName = imageMatch[1];
      const result = await processOutput([
        "docker",
        "ps",
        "--filter",
        `ancestor=${imageName}`,
        "--format",
        "{{.ID}}",
      ]);
      return result.trim().length > 0;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Get child process PIDs (for termination)
 */
async function getChildPids(pid: number): Promise<number[]> {
  try {
    if (isWindows()) {
      const result = await psExec(
        `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty ProcessId`,
        3000,
      );
      return result
        .split("\n")
        .map((line) => parseInt(line.trim()))
        .filter((n) => !isNaN(n) && n > 0);
    } else {
      // On Unix, use ps --ppid
      const result = await $`ps --no-headers -o pid --ppid ${pid}`
        .nothrow()
        .text();
      return result
        .trim()
        .split("\n")
        .filter((p: string) => p.trim())
        .map((p: string) => parseInt(p))
        .filter((n: number) => !isNaN(n));
    }
  } catch {
    return [];
  }
}

export function selectTerminableDescendants(
  rootPid: number,
  parentByPid: ReadonlyMap<number, number>,
  protectedPids: ReadonlySet<number>,
): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, parent] of parentByPid) {
    const list = children.get(parent) ?? [];
    list.push(pid);
    children.set(parent, list);
  }

  const selected: number[] = [];
  const visit = (parent: number) => {
    for (const child of children.get(parent) ?? []) {
      if (protectedPids.has(child)) continue;
      visit(child);
      selected.push(child);
    }
  };
  visit(rootPid);
  return selected;
}

async function getOtherRegisteredPids(targetPid: number): Promise<Set<number>> {
  try {
    const { getAllProcesses } = await import("./db");
    return new Set(
      getAllProcesses()
        .map((proc) => proc.pid)
        .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== targetPid),
    );
  } catch {
    return new Set();
  }
}

async function getWindowsProcessTree(): Promise<Map<number, number>> {
  const output = await psExec(
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    10000,
  );
  if (!output.trim()) return new Map();
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return new Map(
    rows
      .map(
        (row) => [Number(row.ProcessId), Number(row.ParentProcessId)] as const,
      )
      .filter(([child, parent]) => child > 0 && parent >= 0),
  );
}

/**
 * Terminate a process and its children
 */
export async function terminateProcess(
  pid: number,
  force: boolean = false,
  startIdentity?: string,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (startIdentity) {
    const currentIdentity = getProcessBirthId(pid);
    if (!currentIdentity || currentIdentity !== startIdentity) {
      throw new Error(`PID ${pid} ownership changed before termination`);
    }
  }

  clearProcessRunningCache(pid);
  const protectedPids = await getOtherRegisteredPids(pid);
  if (isWindows()) {
    let descendants: number[] = [];
    try {
      descendants = selectTerminableDescendants(
        pid,
        await getWindowsProcessTree(),
        protectedPids,
      );
    } catch {
      // A failed snapshot must not fall back to /T, which could kill another
      // registered process. Killing only the requested PID is the safe fallback.
    }
    for (const childPid of descendants) {
      await processOutput(["taskkill", "/F", "/PID", String(childPid)]);
    }
    await processOutput(["taskkill", "/F", "/PID", String(pid)]);
  } else {
    const children = (await getChildPids(pid)).filter(
      (childPid) => !protectedPids.has(childPid),
    );
    const signal = force ? "KILL" : "TERM";

    for (const childPid of children) {
      await $`kill -${signal} ${childPid}`.nothrow().quiet();
    }
    await $`kill -${signal} ${pid}`.nothrow().quiet();
  }

  await Bun.sleep(force ? 150 : 500);
  clearProcessRunningCache(pid);
  if (startIdentity) {
    const currentIdentity = getProcessBirthId(pid);
    if (!currentIdentity || currentIdentity !== startIdentity) return;
  }
  if (!(await isProcessRunning(pid))) return;
  if (await isProcessRunning(pid)) {
    throw new Error(`PID ${pid} did not exit`);
  }
}

/**
 * Check if a port is free by attempting to bind to it.
 * On Windows, also checks whether the process holding the port is actually alive
 * (zombie sockets from dead processes don't block new binds on 0.0.0.0).
 */
export async function isPortFree(port: number): Promise<boolean> {
  try {
    if (isWindows()) {
      // On Windows, check netstat for anything LISTENING on this port
      const result = await processOutput(["netstat", "-ano"]);
      for (const line of result.split("\n")) {
        // Only match exact port (avoid :35560 matching :3556)
        const match = line.match(
          new RegExp(`:(${port})\\s+.*LISTENING\\s+(\\d+)`),
        );
        if (match) {
          const pid = parseInt(match[2]);
          // If the PID behind the socket is dead, it's a zombie socket
          // A new process can still bind to the port on 0.0.0.0
          if (pid > 0 && (await isProcessRunning(pid))) {
            return false; // Real process holding the port
          }
          // else: zombie socket — consider port free
        }
      }
      return true;
    } else {
      const result = await $`ss -tln sport = :${port}`.nothrow().quiet().text();
      // If output has more than the header line, port is in use
      const lines = result
        .trim()
        .split("\n")
        .filter((l: string) => l.trim());
      return lines.length <= 1;
    }
  } catch {
    // If we can't check, assume it's free
    return true;
  }
}

/**
 * Get info about what's using a port.
 * Returns { inUse: boolean, pid?: number, processName?: string }
 */
export async function getPortInfo(
  port: number,
): Promise<{ inUse: boolean; pid?: number; processName?: string }> {
  try {
    if (isWindows()) {
      const result = await processOutput(["netstat", "-ano"]);
      for (const line of result.split("\n")) {
        const match = line.match(
          new RegExp(`:(${port})\\s+.*LISTENING\\s+(\\d+)`),
        );
        if (match) {
          const pid = parseInt(match[2]);
          if (pid > 0 && (await isProcessRunning(pid))) {
            // Get process name
            const nameResult = await psExec(
              `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`,
            );
            return {
              inUse: true,
              pid,
              processName: nameResult.trim() || "unknown",
            };
          }
        }
      }
      return { inUse: false };
    } else {
      const result = await $`ss -tln sport = :${port}`.nothrow().quiet().text();
      const lines = result
        .trim()
        .split("\n")
        .filter((l: string) => l.trim());
      if (lines.length > 1) {
        return { inUse: true };
      }
      return { inUse: false };
    }
  } catch {
    return { inUse: false };
  }
}

/**
 * Wait for a port to become free, polling with timeout.
 * Returns true if port is free, false if timeout reached.
 */
export async function waitForPortFree(
  port: number,
  timeoutMs: number = 5000,
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 300;

  while (Date.now() - startTime < timeoutMs) {
    if (await isPortFree(port)) {
      return true;
    }
    await Bun.sleep(pollInterval);
  }
  return false;
}

/**
 * Kill processes using a specific port.
 * Force-kills all processes bound to the port and verifies they're gone.
 * On Windows, filters out zombie PIDs (sockets orphaned by dead processes)
 * since taskkill can't kill those — they require a reboot or TCP stack reset.
 */
export async function killProcessOnPort(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return;

  try {
    const pids = new Set<number>();

    if (isWindows()) {
      // Only kill PIDs that are LISTENING on the exact local port.
      // Never match ESTABLISHED/remote connections: doing so can kill reverse
      // proxies such as Caddy that merely connect to the managed app port.
      const result = await processOutput(["netstat", "-ano"]);
      for (const line of result.split("\n")) {
        const match = line.match(
          /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/,
        );
        if (!match || Number(match[1]) !== port) continue;
        const pid = Number(match[2]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    } else {
      // Listener-only. `lsof -ti :PORT` also returns client connections and can
      // therefore select Caddy/nginx/other unrelated processes.
      const result = await $`lsof -nP -tiTCP:${port} -sTCP:LISTEN`
        .nothrow()
        .quiet()
        .text();
      for (const line of result.trim().split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
    }

    for (const pid of pids) {
      if (!(await isProcessRunning(pid))) continue;
      if (isWindows()) {
        await processOutput(["taskkill", "/F", "/T", "/PID", String(pid)]);
      } else {
        await $`kill -KILL ${pid}`.nothrow().quiet();
      }
    }
  } catch {
    // Best-effort helper. Callers must not treat port ownership as proof that a
    // process belongs to bgrun.
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Get the shell command array for spawning a process
 * On Windows uses cmd.exe, on Unix uses sh
 */
export function getShellCommand(command: string): string[] {
  if (isWindows()) {
    return [process.env.ComSpec || "cmd.exe", "/c", command];
  } else {
    return ["sh", "-c", command];
  }
}
/**
 * Find the actual child process PID spawned by a shell wrapper.
 * Traverses the process tree to find the deepest (leaf) child.
 * On Windows, bgr spawn creates: cmd.exe → bun.exe (typically 1-2 levels)
 *
 * Uses PowerShell with -NoProfile and a hard timeout to prevent hangs.
 */
export async function findChildPid(parentPid: number): Promise<number> {
  let currentPid = parentPid;
  const maxDepth = 2; // cmd.exe → bun.exe is the typical chain

  for (let depth = 0; depth < maxDepth; depth++) {
    try {
      let childPids: number[] = [];

      if (isWindows()) {
        const result = await psExec(
          `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${currentPid}' | Select-Object -ExpandProperty ProcessId`,
          3000,
        );
        childPids = result
          .split("\n")
          .map((line: string) => parseInt(line.trim()))
          .filter((n: number) => !isNaN(n) && n > 0);
      } else {
        const result = await $`ps --no-headers -o pid --ppid ${currentPid}`
          .nothrow()
          .text();
        childPids = result
          .trim()
          .split("\n")
          .map((line: string) => parseInt(line.trim()))
          .filter((n: number) => !isNaN(n) && n > 0);
      }

      if (childPids.length === 0) break;
      currentPid = childPids[0];
    } catch {
      break;
    }
  }

  return currentPid;
}

/**
 * Find a live bgrun-managed process by the exact BGR_PROCESS_NAME marker.
 * This is intentionally supported on Unix only, where /proc exposes the
 * inherited environment and cwd without heuristic command matching.
 */
export async function findManagedProcessPid(
  processName: string,
  command?: string,
  workdir?: string,
): Promise<number | null> {
  if (!processName || isWindows()) return null;

  try {
    const marker = `BGR_PROCESS_NAME=${processName}\0`;
    const candidates: number[] = [];
    const entries = fs
      .readdirSync("/proc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));

    for (const entry of entries) {
      const pid = Number(entry.name);
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;

      try {
        const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
        if (!environ.includes(marker)) continue;
        if (workdir && fs.readlinkSync(`/proc/${pid}/cwd`) !== workdir)
          continue;
        if (command && !(await isProcessRunning(pid, command))) continue;
        candidates.push(pid);
      } catch {
        // Process exited or is not inspectable.
      }
    }

    return candidates.length === 1 ? candidates[0] : null;
  } catch {
    return null;
  }
}

/**
 * Reconcile stale PIDs: when a stored PID is dead, search for a live process
 * matching the same command line and update the DB with the correct PID.
 *
 * This handles the case where cmd.exe wrapper PIDs die after spawning the
 * actual bun.exe child process, or after a system reboot where PIDs change.
 *
 * Returns a map of process name → reconciled PID for all matched processes.
 */
export async function reconcileProcessPids(
  processes: Array<{
    name: string;
    pid: number;
    command: string;
    workdir: string;
  }>,
  deadPids: Set<number>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  // Never globally score "similar" commands. Reconcile only when the exact
  // bgrun process-name marker proves identity. On Windows this intentionally
  // returns no matches; a stale row is safer than a guessed PID.
  for (const proc of processes) {
    if (proc.pid <= 0 || !deadPids.has(proc.pid)) continue;
    const pid = await findManagedProcessPid(
      proc.name,
      proc.command,
      proc.workdir,
    );
    if (pid) result.set(proc.name, pid);
  }

  return result;
}

/**
 * Wait for a port to become active and return the PID listening on it.
 * More reliable than findChildPid since it waits for the actual server
 * to bind the port rather than racing the process tree traversal.
 */
export async function findPidByPort(
  port: number,
  maxWaitMs = 8000,
): Promise<number | null> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  const start = Date.now();
  const pollMs = 250;

  while (Date.now() - start < maxWaitMs) {
    try {
      if (isWindows()) {
        const result = await processOutput(["netstat", "-ano"]);
        for (const line of result.split("\n")) {
          const match = line.match(
            /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/,
          );
          if (!match || Number(match[1]) !== port) continue;
          const pid = Number(match[2]);
          if (Number.isInteger(pid) && pid > 0) return pid;
        }
      } else {
        const result = await $`lsof -nP -tiTCP:${port} -sTCP:LISTEN`
          .nothrow()
          .quiet()
          .text();
        const pid = Number(result.trim().split(/\r?\n/)[0]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
    } catch {
      /* retry */
    }

    await Bun.sleep(pollMs);
  }

  return null;
}

export async function readFileTail(
  filePath: string,
  lines?: number,
): Promise<string> {
  try {
    const content = await Bun.file(filePath).text();
    if (!lines) return content;
    return content.split(/\r?\n/).slice(-lines).join("\n");
  } catch (error) {
    throw new Error(`Error reading file: ${error}`);
  }
}

/**
 * Copy a file from source to destination
 */
export function copyFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest);
}

/**
 * Get memory usage of a process in bytes
 */
export async function getProcessMemory(pid: number): Promise<number> {
  const map = await getProcessBatchResources([pid]);
  return map.get(pid)?.memory || 0;
}

/**
 * Get memory and CPU usage for a batch of PIDs.
 * Returns a Map of PID -> { memory: bytes, cpu: number }.
 * On Windows, CPU is cumulative time in seconds.
 * On Unix, CPU is instantaneous percentage.
 *
 * Optimization: Fetches ALL processes in one go and filters in-memory
 * to avoid spawning N subprocesses.
 */
export async function getProcessBatchResources(
  pids: number[],
): Promise<Map<number, { memory: number; cpu: number }>> {
  if (pids.length === 0) return new Map();

  const resourceMap = new Map<number, { memory: number; cpu: number }>();
  const pidSet = new Set(pids);

  try {
    if (isWindows()) {
      const output = await psExec(
        `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id, WorkingSet64 | ForEach-Object { Write-Output "$($_.Id)|$($_.WorkingSet64)" }`,
      );
      for (const line of output.split("\n")) {
        const sepIdx = line.indexOf("|");
        if (sepIdx === -1) continue;
        const pid = parseInt(line.substring(0, sepIdx).trim());
        const memory = parseInt(line.substring(sepIdx + 1).trim()) || 0;
        if (!isNaN(pid) && pidSet.has(pid)) {
          resourceMap.set(pid, { memory, cpu: 0 });
        }
      }
    } else {
      const result = await $`ps -eo pid,pcpu,rss`.nothrow().quiet().text();
      const lines = result.trim().split("\n");

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const [pidStr, cpuStr, rssStr] = line.split(/\s+/);
        const pid = parseInt(pidStr);
        const cpu = parseFloat(cpuStr) || 0;
        const rss = parseInt(rssStr) || 0;

        if (pidSet.has(pid)) {
          resourceMap.set(pid, { memory: rss * 1024, cpu });
        }
      }
    }
  } catch {}

  return resourceMap;
}

export type SystemProcessResource = {
  pid: number;
  cpu: number;
  memory: number;
  executable: string;
  command: string;
};

/**
 * Snapshot all system processes in one OS query.
 *
 * On Unix, cpu is instantaneous percent and memory is RSS bytes. On Windows
 * the lightweight Get-Process fallback exposes cumulative CPU seconds; callers
 * should treat that as diagnostic rather than a precise instantaneous percent.
 */
export async function getSystemProcessResources(): Promise<
  SystemProcessResource[]
> {
  try {
    if (isWindows()) {
      const output = await psExec(
        `Get-Process -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "$($_.Id)|$([double]$_.CPU)|$($_.WorkingSet64)|$($_.ProcessName)|$($_.Path)" }`,
        5000,
      );
      const rows: SystemProcessResource[] = [];
      for (const line of output.split("\n")) {
        const parts = line.split("|");
        if (parts.length < 4) continue;
        const pid = parseInt(parts[0]?.trim() || "", 10);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        rows.push({
          pid,
          cpu: Number(parts[1]) || 0,
          memory: Number(parts[2]) || 0,
          executable: parts[3]?.trim() || "",
          command: parts.slice(4).join("|").trim() || parts[3]?.trim() || "",
        });
      }
      return rows;
    }

    const output = await $`ps -eo pid=,pcpu=,rss=,comm=,args=`
      .nothrow()
      .quiet()
      .text();
    const rows: SystemProcessResource[] = [];
    for (const line of output.split("\n")) {
      const match = line.match(/^\s*(\d+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) continue;
      const pid = parseInt(match[1], 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      rows.push({
        pid,
        cpu: parseFloat(match[2]) || 0,
        memory: (parseInt(match[3], 10) || 0) * 1024,
        executable: match[4] || "",
        command: match[5]?.trim() || match[4] || "",
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function addListeningPort(
  map: Map<number, Set<number>>,
  pid: number,
  port: number,
  filter: Set<number> | null,
) {
  if (pid <= 0 || port <= 0 || port > 65535) return;
  if (filter && !filter.has(pid)) return;
  const ports = map.get(pid) || new Set<number>();
  ports.add(port);
  map.set(pid, ports);
}

/**
 * Snapshot listening TCP ports for many processes with one OS query.
 * This is intentionally LISTEN-only so reverse-proxy/client connections are
 * never confused with local port ownership.
 */
export async function getListeningPortsByPid(
  pids?: number[],
): Promise<Map<number, number[]>> {
  const filter = pids ? new Set(pids.filter((pid) => pid > 0)) : null;
  const result = new Map<number, Set<number>>();

  try {
    if (isWindows()) {
      const output = await processOutput(["netstat", "-ano"]);
      for (const line of output.split("\n")) {
        const match = line.match(
          /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i,
        );
        if (!match) continue;
        addListeningPort(
          result,
          parseInt(match[2], 10),
          parseInt(match[1], 10),
          filter,
        );
      }
    } else {
      const output = await $`ss -ltnpH`.nothrow().quiet().text();
      for (const line of output.split("\n")) {
        const columns = line.trim().split(/\s+/);
        if (columns.length < 4) continue;
        const local = columns[3] || "";
        const portMatch = local.match(/:(\d+)$/);
        if (!portMatch) continue;
        const port = parseInt(portMatch[1], 10);
        for (const pidMatch of line.matchAll(/pid=(\d+)/g)) {
          addListeningPort(result, parseInt(pidMatch[1], 10), port, filter);
        }
      }

      if (result.size === 0) {
        const lsof = await $`lsof -nP -iTCP -sTCP:LISTEN`
          .nothrow()
          .quiet()
          .text();
        for (const line of lsof.split("\n").slice(1)) {
          const columns = line.trim().split(/\s+/);
          if (columns.length < 9) continue;
          const pid = parseInt(columns[1] || "", 10);
          const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
          if (!portMatch) continue;
          addListeningPort(result, pid, parseInt(portMatch[1], 10), filter);
        }
      }
    }
  } catch {}

  return new Map(
    [...result.entries()].map(([pid, ports]) => [
      pid,
      [...ports].sort((a, b) => a - b),
    ]),
  );
}

/**
 * Parse Unix lsof LISTEN output and return only true listening TCP ports.
 */
export function parseUnixListeningPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split("\n")) {
    const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (portMatch) {
      ports.add(parseInt(portMatch[1]));
    }
  }
  return Array.from(ports);
}

/**
 * Get the TCP ports a process is currently listening on by querying the OS.
 * Returns an array of port numbers (empty if none or process not found).
 */
export async function getProcessPorts(pid: number): Promise<number[]> {
  try {
    if (isWindows()) {
      // netstat -ano lists all connections with PIDs
      const result = await processOutput(["netstat", "-ano"]);
      const ports = new Set<number>();
      for (const line of result.split("\n")) {
        // Match lines like: TCP    0.0.0.0:3556    0.0.0.0:0    LISTENING    8608
        const match = line.match(
          /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/,
        );
        if (match && parseInt(match[2]) === pid) {
          ports.add(parseInt(match[1]));
        }
      }
      return Array.from(ports);
    } else {
      // Unix: use ss (modern) with fallback to lsof
      try {
        const result = await $`ss -tlnp`.nothrow().quiet().text();
        const ports = new Set<number>();
        for (const line of result.split("\n")) {
          if (line.includes(`pid=${pid}`)) {
            const portMatch = line.match(/:(\d+)\s/);
            if (portMatch) {
              ports.add(parseInt(portMatch[1]));
            }
          }
        }
        if (ports.size > 0) return Array.from(ports);
      } catch {
        /* ss not available, try lsof */
      }

      const result = await $`lsof -Pan -p ${pid} -iTCP -sTCP:LISTEN`
        .nothrow()
        .quiet()
        .text();
      return parseUnixListeningPorts(result);
    }
  } catch {
    return [];
  }
}

export async function resolvePidWithPorts(
  pid: number,
): Promise<{ pid: number; ports: number[] }> {
  const ports = await getProcessPorts(pid);
  if (ports.length > 0 || !isWindows() || pid <= 0) {
    return { pid, ports };
  }

  const childPid = await findChildPid(pid);
  if (childPid === pid || childPid <= 0) {
    return { pid, ports };
  }

  const childPorts = await getProcessPorts(childPid);
  if (childPorts.length > 0) {
    return { pid: childPid, ports: childPorts };
  }

  return { pid, ports };
}