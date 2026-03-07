/**
 * Cross-platform utility functions for BGR
 * Provides Windows and Unix compatible process management
 */

import * as fs from "fs";
import * as os from "os";
import { join } from "path";
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
  // PID 0 means intentionally stopped — never alive
  if (pid <= 0) return false;

  return (await plat.measure(`PID ${pid} alive?`, async () => {
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
  })) ?? false;
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
    try {
      if (isWindows()) {
        // Always use /T (tree kill) on Windows to kill the entire process tree
        // This prevents grandchild processes from surviving as zombies
        await $`taskkill /F /T /PID ${pid}`.nothrow().quiet();
      } else {
        // On Unix, kill children first, then parent
        const children = await m('Get children', () => getChildPids(pid)) ?? [];
        const signal = force ? 'KILL' : 'TERM';
        for (const childPid of children) {
          try {
            await $`kill -${signal} ${childPid}`.nothrow();
          } catch { /* already dead */ }
        }
        await Bun.sleep(500);
        if (await isProcessRunning(pid)) {
          await $`kill -${signal} ${pid}`.nothrow();
        }
      }
    } catch {
      // Ignore errors for already-dead processes
    }

    // Wait for process to fully exit
    await Bun.sleep(300);
  });
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
      const result = await $`netstat -ano | findstr :${port}`.nothrow().quiet().text();
      for (const line of result.split('\n')) {
        // Only match exact port (avoid :35560 matching :3556)
        const match = line.match(new RegExp(`:(${port})\\s+.*LISTENING\\s+(\\d+)`));
        if (match) {
          const pid = parseInt(match[2]);
          // If the PID behind the socket is dead, it's a zombie socket
          // A new process can still bind to the port on 0.0.0.0
          if (pid > 0 && await isProcessRunning(pid)) {
            return false; // Real process holding the port
          }
          // else: zombie socket — consider port free
        }
      }
      return true;
    } else {
      const result = await $`ss -tln sport = :${port}`.nothrow().quiet().text();
      // If output has more than the header line, port is in use
      const lines = result.trim().split('\n').filter((l: string) => l.trim());
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
 * On Windows, filters out zombie PIDs (sockets orphaned by dead processes)
 * since taskkill can't kill those — they require a reboot or TCP stack reset.
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
        // Check if the process actually exists before trying to kill it
        // This avoids the zombie PID issue where sockets linger after process death
        const alive = await isProcessRunning(pid);
        if (alive) {
          await $`taskkill /F /T /PID ${pid}`.nothrow().quiet();
          console.log(`Killed process ${pid} using port ${port}`);
        } else {
          // Zombie socket — PID no longer exists but socket lingers in kernel
          console.warn(`⚠ Port ${port} held by zombie PID ${pid} (process dead, socket stuck in kernel). Will clear on reboot or TCP timeout.`);
        }
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
 * Reconcile stale PIDs: when a stored PID is dead, search for a live process
 * matching the same command line and update the DB with the correct PID.
 * 
 * This handles the case where cmd.exe wrapper PIDs die after spawning the
 * actual bun.exe child process, or after a system reboot where PIDs change.
 * 
 * Returns a map of process name → reconciled PID for all matched processes.
 */
export async function reconcileProcessPids(
  processes: Array<{ name: string; pid: number; command: string; workdir: string }>,
  deadPids: Set<number>,
): Promise<Map<string, number>> {
  return await plat.measure('Reconcile PIDs', async () => {
    const result = new Map<string, number>();
    // Skip processes with PID=0 — these were intentionally stopped
    // and should NOT be reconciled to avoid hijacking unrelated processes
    const needsReconciliation = processes.filter(p => deadPids.has(p.pid) && p.pid > 0);
    if (needsReconciliation.length === 0) return result;

    try {
      // Get all running processes with their command lines
      let runningProcs: Array<{ pid: number; cmdLine: string }> = [];

      if (isWindows()) {
        // Write a temp PS1 script to avoid quoting issues with $() in Bun's shell
        const tmpScript = join(os.tmpdir(), 'bgr-reconcile.ps1');
        const psCode = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'bun.exe' } | ForEach-Object { Write-Output "$($_.ProcessId)|$($_.CommandLine)" }`;
        await Bun.write(tmpScript, psCode);

        const ps = Bun.spawnSync(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript]);
        const output = ps.stdout.toString();

        for (const line of output.split('\n')) {
          const sepIdx = line.indexOf('|');
          if (sepIdx === -1) continue;
          const pid = parseInt(line.substring(0, sepIdx).trim());
          const cmdLine = line.substring(sepIdx + 1).trim();
          if (!isNaN(pid) && pid > 0 && cmdLine) {
            runningProcs.push({ pid, cmdLine });
          }
        }
      } else {
        const psOutput = await $`ps -eo pid,args --no-headers`.nothrow().quiet().text();
        for (const line of psOutput.trim().split('\n')) {
          const match = line.trim().match(/^(\d+)\s+(.+)/);
          if (match) {
            runningProcs.push({ pid: parseInt(match[1]), cmdLine: match[2] });
          }
        }
      }

      // For each dead process, try to find a matching live process
      // Uses multi-criteria scoring to avoid false matches when multiple
      // processes share similar commands (e.g. "bun run server.ts")
      for (const proc of needsReconciliation) {
        const cmdParts = proc.command.split(/\s+/);
        // Extract meaningful parts: full command and workdir path segments
        const workdirParts = proc.workdir.replace(/\\/g, '/').split('/').filter(Boolean);
        const workdirLast = workdirParts[workdirParts.length - 1]?.toLowerCase() || '';

        let bestMatch: { pid: number; score: number } | null = null;
        let ambiguous = false;

        for (const running of runningProcs) {
          const cmdLower = running.cmdLine.toLowerCase();
          let score = 0;

          // Score 1: command parts match (e.g. "run", "server.ts")
          for (const part of cmdParts) {
            if (part.length > 2 && cmdLower.includes(part.toLowerCase())) score++;
          }

          // Score 2: workdir folder name appears in command line path
          // This distinguishes "bun run server.ts" in different directories
          if (workdirLast && cmdLower.includes(workdirLast)) score += 3;

          // Score 3: full workdir path match (strongest signal)
          if (cmdLower.includes(proc.workdir.toLowerCase().replace(/\\/g, '/'))) score += 5;
          if (cmdLower.includes(proc.workdir.toLowerCase())) score += 5;

          if (score < 4) continue; // Require workdir evidence — generic cmd matches alone aren't enough

          if (!bestMatch || score > bestMatch.score) {
            ambiguous = false;
            bestMatch = { pid: running.pid, score };
          } else if (score === bestMatch.score) {
            ambiguous = true; // Multiple equally good matches — skip
          }
        }

        if (bestMatch && !ambiguous) {
          result.set(proc.name, bestMatch.pid);
          runningProcs = runningProcs.filter(p => p.pid !== bestMatch!.pid);
        }
      }
    } catch {
      // Reconciliation is best-effort — return partial results
    }

    return result;
  }) ?? new Map();
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
  return (await plat.measure(`Read tail ${lines ?? 'all'}L`, async () => {
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
  })) ?? '';
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
export async function getProcessBatchResources(pids: number[]): Promise<Map<number, { memory: number, cpu: number }>> {
  if (pids.length === 0) return new Map();

  return await plat.measure(`Batch resources (${pids.length} PIDs)`, async () => {
    const resourceMap = new Map<number, { memory: number, cpu: number }>();
    const pidSet = new Set(pids);

    try {
      if (isWindows()) {
        const result = await $`powershell -Command "Get-Process | Select-Object Id, CPU, WorkingSet"`.nothrow().quiet().text();
        const lines = result.trim().split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('Id') || trimmed.startsWith('--')) continue;

          // Replace multiple spaces with a single space to parse correctly
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 3) {
            const pid = parseInt(parts[0]);
            // CPU can sometimes be blank if process is just starting, handle that
            let cpuStr = parts[1];
            let memStr = parts[2];
            if (parts.length === 2) {
              // If CPU is missing, powershell might omit it and give just ID and WorkingSet
              cpuStr = "0";
              memStr = parts[1];
            }

            const cpu = parseFloat(cpuStr) || 0;
            const memory = parseInt(memStr) || 0;

            if (!isNaN(pid) && !isNaN(memory)) {
              if (pidSet.has(pid)) resourceMap.set(pid, { memory, cpu });
            }
          }
        }
      } else {
        const result = await $`ps -eo pid,pcpu,rss`.nothrow().quiet().text();
        const lines = result.trim().split('\n');

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
    } catch (e) {
      // silently fail
    }

    return resourceMap;
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
