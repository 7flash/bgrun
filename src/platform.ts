/**
 * Cross-platform utility functions for BGR
 * Provides Windows and Unix compatible process management
 */

import * as fs from "fs";
import * as os from "os";
import { $ } from "bun";
import { measure, createMeasure } from "measure-fn";

const plat = createMeasure('platform');

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
export async function isProcessRunning(pid: number, command?: string): Promise<boolean> {
  return plat.measure(`PID ${pid} alive?`, async () => {
    try {
      // Docker container detection
      if (command && (command.includes('docker run') || command.includes('docker-compose up') || command.includes('docker compose up'))) {
        return await isDockerContainerRunning(command);
      }

      if (isWindows()) {
        const result = await $`tasklist /FI "PID eq ${pid}" /NH`.nothrow().text();
        return result.includes(`${pid}`);
      } else {
        const result = await $`ps -p ${pid}`.nothrow().text();
        return result.includes(`${pid}`);
      }
    } catch {
      return false;
    }
  });
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
      const result = await $`docker inspect -f "{{.State.Running}}" ${containerName}`.nothrow().text();
      return result.trim() === 'true';
    }

    // If no --name, try to find running containers that match the image
    // Extract image name (last argument before -d or after -d)
    const imageMatch = command.match(/docker\s+run\s+.*?(?:-d\s+)?(\S+)\s*$/);
    if (imageMatch) {
      const imageName = imageMatch[1];
      const result = await $`docker ps --filter ancestor=${imageName} --format "{{.ID}}"`.nothrow().text();
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
      // On Windows, use PowerShell to get child processes
      const result = await $`powershell -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object -ExpandProperty ProcessId"`.nothrow().text();
      return result
        .split('\n')
        .map(line => parseInt(line.trim()))
        .filter(n => !isNaN(n) && n > 0);
    } else {
      // On Unix, use ps --ppid
      const result = await $`ps --no-headers -o pid --ppid ${pid}`.nothrow().text();
      return result
        .trim()
        .split('\n')
        .filter(p => p.trim())
        .map(p => parseInt(p))
        .filter(n => !isNaN(n));
    }
  } catch {
    return [];
  }
}

/**
 * Terminate a process and its children
 */
export async function terminateProcess(pid: number, force: boolean = false): Promise<void> {
  await plat.measure(`Terminate PID ${pid}`, async (m) => {
    // First, kill children
    const children = await m('Get children', () => getChildPids(pid)) ?? [];

    for (const childPid of children) {
      try {
        if (isWindows()) {
          if (force) {
            await $`taskkill /F /PID ${childPid}`.nothrow().quiet();
          } else {
            await $`taskkill /PID ${childPid}`.nothrow().quiet();
          }
        } else {
          const signal = force ? 'KILL' : 'TERM';
          await $`kill -${signal} ${childPid}`.nothrow();
        }
      } catch {
        // Ignore errors for already-dead processes
      }
    }

    // Wait a bit for graceful shutdown
    await Bun.sleep(500);

    // Then kill the parent if still running
    if (await isProcessRunning(pid)) {
      try {
        if (isWindows()) {
          if (force) {
            await $`taskkill /F /PID ${pid}`.nothrow().quiet();
          } else {
            await $`taskkill /PID ${pid}`.nothrow().quiet();
          }
        } else {
          const signal = force ? 'KILL' : 'TERM';
          await $`kill -${signal} ${pid}`.nothrow();
        }
      } catch {
        // Ignore errors
      }
    }
  });
}

/**
 * Check if a port is free by attempting to bind to it.
 */
export async function isPortFree(port: number): Promise<boolean> {
  try {
    if (isWindows()) {
      // On Windows, check netstat for anything LISTENING on this port
      const result = await $`netstat -ano | findstr :${port}`.nothrow().quiet().text();
      for (const line of result.split('\n')) {
        // Only match exact port (avoid :35560 matching :3556)
        const match = line.match(new RegExp(`:(${port})\\s+.*LISTENING`));
        if (match) return false;
      }
      return true;
    } else {
      const result = await $`ss -tln sport = :${port}`.nothrow().quiet().text();
      // If output has more than the header line, port is in use
      const lines = result.trim().split('\n').filter(l => l.trim());
      return lines.length <= 1;
    }
  } catch {
    // If we can't check, assume it's free
    return true;
  }
}

/**
 * Wait for a port to become free, polling with timeout.
 * Returns true if port is free, false if timeout reached.
 */
export async function waitForPortFree(port: number, timeoutMs: number = 5000): Promise<boolean> {
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
 */
export async function killProcessOnPort(port: number): Promise<void> {
  try {
    if (isWindows()) {
      // On Windows, use netstat to find processes on port
      const result = await $`netstat -ano | findstr :${port}`.nothrow().quiet().text();
      const pids = new Set<number>();

      for (const line of result.split('\n')) {
        // Match exact port — avoid :35560 matching :3556
        // Match any state (LISTENING, ESTABLISHED, TIME_WAIT, etc.)
        const match = line.match(new RegExp(`:(${port})\\s+.*?\\s+(\\d+)\\s*$`));
        if (match && parseInt(match[1]) === port) {
          const pid = parseInt(match[2]);
          if (pid > 0) pids.add(pid);
        }
      }

      for (const pid of pids) {
        // Force kill with /F /T (tree kill to get children too)
        await $`taskkill /F /T /PID ${pid}`.nothrow().quiet();
        console.log(`Killed process ${pid} using port ${port}`);
      }
    } else {
      // On Unix, use lsof
      const result = await $`lsof -ti :${port}`.nothrow().text();
      if (result.trim()) {
        const pids = result.trim().split('\n').filter(pid => pid);
        for (const pid of pids) {
          await $`kill -9 ${pid}`.nothrow();
          console.log(`Killed process ${pid} using port ${port}`);
        }
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not check or kill process on port ${port}: ${error}`);
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
    return ["cmd", "/c", command];
  } else {
    return ["sh", "-c", command];
  }
}

/**
 * Find the actual child process PID spawned by a shell wrapper.
 * Traverses the process tree recursively to find the deepest (leaf) child.
 * On Windows, bgr spawn creates: cmd.exe → bgr.exe → bun.exe
 * We need the bun.exe PID, not the intermediate bgr.exe.
 */
export async function findChildPid(parentPid: number): Promise<number> {
  let currentPid = parentPid;
  const maxDepth = 5; // Safety limit to avoid infinite loops

  for (let depth = 0; depth < maxDepth; depth++) {
    try {
      let childPids: number[] = [];

      if (isWindows()) {
        const result = await $`powershell -Command "Get-CimInstance Win32_Process -Filter 'ParentProcessId=${currentPid}' | Select-Object -ExpandProperty ProcessId"`.nothrow().text();
        childPids = result
          .split('\n')
          .map((line: string) => parseInt(line.trim()))
          .filter((n: number) => !isNaN(n) && n > 0);
      } else {
        const result = await $`ps --no-headers -o pid --ppid ${currentPid}`.nothrow().text();
        childPids = result
          .trim()
          .split('\n')
          .map(line => parseInt(line.trim()))
          .filter(n => !isNaN(n) && n > 0);
      }

      if (childPids.length === 0) {
        // No children — currentPid is the leaf process
        break;
      }

      // Follow the first child deeper
      currentPid = childPids[0];
    } catch {
      break;
    }
  }

  return currentPid;
}

/**
 * Wait for a port to become active and return the PID listening on it.
 * More reliable than findChildPid since it waits for the actual server
 * to bind the port rather than racing the process tree traversal.
 */
export async function findPidByPort(port: number, maxWaitMs = 8000): Promise<number | null> {
  const start = Date.now();
  const pollMs = 500;

  while (Date.now() - start < maxWaitMs) {
    try {
      if (isWindows()) {
        const result = await $`netstat -ano`.nothrow().quiet().text();
        for (const line of result.split('\n')) {
          if (line.includes(`:${port}`) && line.includes('LISTENING')) {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1]);
            if (!isNaN(pid) && pid > 0) return pid;
          }
        }
      } else {
        try {
          const result = await $`ss -tlnp`.nothrow().quiet().text();
          for (const line of result.split('\n')) {
            if (line.includes(`:${port}`)) {
              const pidMatch = line.match(/pid=(\d+)/);
              if (pidMatch) return parseInt(pidMatch[1]);
            }
          }
        } catch { /* ss not available, try lsof */ }

        const result = await $`lsof -iTCP:${port} -sTCP:LISTEN -t`.nothrow().quiet().text();
        const pid = parseInt(result.trim());
        if (!isNaN(pid) && pid > 0) return pid;
      }
    } catch { /* retry */ }

    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return null;
}

export async function readFileTail(filePath: string, lines?: number): Promise<string> {
  return plat.measure(`Read tail ${lines ?? 'all'}L`, async () => {
    try {
      const content = await Bun.file(filePath).text();

      if (!lines) {
        return content;
      }

      const allLines = content.split(/\r?\n/);
      const tailLines = allLines.slice(-lines);
      return tailLines.join('\n');
    } catch (error) {
      throw new Error(`Error reading file: ${error}`);
    }
  });
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
  const map = await getProcessBatchMemory([pid]);
  return map.get(pid) || 0;
}

/**
 * Get memory usage for a batch of PIDs in bytes.
 * Returns a Map of PID -> Memory (bytes).
 * 
 * Optimization: Fetches ALL processes in one go and filters in-memory
 * to avoid spawning N subprocesses.
 */
export async function getProcessBatchMemory(pids: number[]): Promise<Map<number, number>> {
  if (pids.length === 0) return new Map();

  return await plat.measure(`Batch memory (${pids.length} PIDs)`, async () => {
    const memoryMap = new Map<number, number>();
    const pidSet = new Set(pids);

    try {
      if (isWindows()) {
        const result = await $`powershell -Command "Get-Process | Select-Object Id, WorkingSet"`.nothrow().quiet().text();
        const lines = result.trim().split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('Id') || trimmed.startsWith('--')) continue;

          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const val1 = parseInt(parts[0]);
            const val2 = parseInt(parts[parts.length - 1]);

            if (!isNaN(val1) && !isNaN(val2)) {
              if (pidSet.has(val1)) memoryMap.set(val1, val2);
            }
          }
        }
      } else {
        const result = await $`ps -eo pid,rss`.nothrow().quiet().text();
        const lines = result.trim().split('\n');

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const [pidStr, rssStr] = line.split(/\s+/);
          const pid = parseInt(pidStr);
          const rss = parseInt(rssStr);

          if (pidSet.has(pid)) {
            memoryMap.set(pid, rss * 1024);
          }
        }
      }
    } catch (e) {
      // silently fail
    }

    return memoryMap;
  }) ?? new Map();
}

/**
 * Get the TCP ports a process is currently listening on by querying the OS.
 * Returns an array of port numbers (empty if none or process not found).
 */
export async function getProcessPorts(pid: number): Promise<number[]> {
  try {
    if (isWindows()) {
      // netstat -ano lists all connections with PIDs
      const result = await $`netstat -ano`.nothrow().quiet().text();
      const ports = new Set<number>();
      for (const line of result.split('\n')) {
        // Match lines like: TCP    0.0.0.0:3556    0.0.0.0:0    LISTENING    8608
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
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
        for (const line of result.split('\n')) {
          if (line.includes(`pid=${pid}`)) {
            const portMatch = line.match(/:(\d+)\s/);
            if (portMatch) {
              ports.add(parseInt(portMatch[1]));
            }
          }
        }
        if (ports.size > 0) return Array.from(ports);
      } catch { /* ss not available, try lsof */ }

      const result = await $`lsof -i -P -n -p ${pid}`.nothrow().quiet().text();
      const ports = new Set<number>();
      for (const line of result.split('\n')) {
        if (line.includes('LISTEN')) {
          const portMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
          if (portMatch) {
            ports.add(parseInt(portMatch[1]));
          }
        }
      }
      return Array.from(ports);
    }
  } catch {
    return [];
  }
}
