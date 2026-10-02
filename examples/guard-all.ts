#!/usr/bin/env bun
/**
 * Multi-Process Guard for BGR
 * Monitors all processes and automatically restarts any that have stopped
 * Supports memory limits and restart intervals from BGR_ prefixed env settings
 *
 * Environment Variables:
 * - BGR_KEEP_ALIVE=true     : Process will be monitored and restarted
 * - BGR_MEMORY_LIMIT=500m   : Restart if memory exceeds limit (k/m/g supported)
 * - BGR_RESTART_INTERVAL=60 : Restart every N minutes regardless of status
 *
 * Usage: bun guard-all.ts [check-interval-seconds]
 * Example: bun guard-all.ts 60  # Check every 60 seconds
 */

import { $, sleep } from "bun";
import * as fs from "fs";
import { join } from "path";
import { getHomeDir, getProcessMemory, copyFile } from "../src/platform";

interface ProcessInfo {
  name: string;
  status: string;
  pid: number;
  env: Record<string, string>;
}

async function getAllProcesses(): Promise<ProcessInfo[]> {
  try {
    // First get all process names
    const listResult = await $`bgr`.quiet().nothrow();
    if (listResult.exitCode !== 0) {
      throw new Error(`bgr command failed: ${listResult.stderr}`);
    }

    // Parse process names from table output
    const processNames: string[] = [];
    const stdout = await listResult.text();
    const lines = stdout.split("\n");

    for (const line of lines) {
      if (
        line.includes("│") &&
        !line.includes("ID") &&
        !line.includes("─") &&
        !line.includes("═")
      ) {
        const parts = line
          .split("│")
          .map((part: string) => part.trim())
          .filter((part: string) => part);
        if (parts.length >= 3) {
          const name = parts[2]; // Name is the 3rd column (index 2)
          if (name && !processNames.includes(name)) {
            processNames.push(name);
          }
        }
      }
    }

    if (processNames.length === 0) {
      return [];
    }

    // Get detailed info using JSON API
    const jsonResult = await $`bgr --json ${processNames.join(",")}`
      .quiet()
      .nothrow();
    if (jsonResult.exitCode !== 0) {
      console.warn(`Failed to get JSON data, falling back to basic info`);
      // Return basic info without env variables
      return processNames.map((name) => ({
        name,
        status: "unknown",
        pid: 0,
        env: {},
      }));
    }

    const jsonStdout = await jsonResult.text();
    const jsonData = JSON.parse(jsonStdout);
    return jsonData;
  } catch (error: any) {
    console.error(`Error getting process list: ${error.message}`);
    return [];
  }
}

async function getMemoryUsage(pid: number): Promise<number> {
  return getProcessMemory(pid);
}

function parseMemoryLimit(limitStr: string): number {
  if (!limitStr) return 0;

  const match = limitStr.match(/^(\d+)([kmg]?)b?$/i);
  if (!match) return 0;

  const value = parseInt(match[1]);
  const unit = match[2]?.toLowerCase() || "";

  switch (unit) {
    case "k":
      return value * 1024;
    case "m":
      return value * 1024 * 1024;
    case "g":
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

async function backupLogs(processName: string): Promise<void> {
  const homePath = getHomeDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const stdoutPath = join(homePath, ".bgr", `${processName}-out.txt`);
  const stderrPath = join(homePath, ".bgr", `${processName}-err.txt`);

  if (fs.existsSync(stdoutPath)) {
    const backupStdout = join(
      homePath,
      ".bgr",
      `${processName}-out-${timestamp}.txt`,
    );
    copyFile(stdoutPath, backupStdout);
    console.log(`📄 Backed up stdout to ${backupStdout}`);
  }

  if (fs.existsSync(stderrPath)) {
    const backupStderr = join(
      homePath,
      ".bgr",
      `${processName}-err-${timestamp}.txt`,
    );
    copyFile(stderrPath, backupStderr);
    console.log(`📄 Backed up stderr to ${backupStderr}`);
  }
}

async function restartProcess(processName: string): Promise<boolean> {
  try {
    console.log(`🔄 Restarting process "${processName}"...`);

    // Backup logs before restart
    await backupLogs(processName);

    const restartResult = await $`bgr ${processName} --restart`.nothrow();

    if (restartResult.exitCode === 0) {
      console.log(`✅ Successfully restarted "${processName}"`);
      return true;
    } else {
      console.error(
        `❌ Failed to restart "${processName}": ${restartResult.stderr}`,
      );
      return false;
    }
  } catch (error: any) {
    console.error(`❌ Error restarting "${processName}": ${error.message}`);
    return false;
  }
}

async function checkProcess(proc: ProcessInfo): Promise<boolean> {
  const env = proc.env;

  // Check if process should be monitored
  const keepAlive = env.BGR_KEEP_ALIVE === "true";
  const memoryLimitStr = env.BGR_MEMORY_LIMIT;
  const restartInterval = parseInt(env.BGR_RESTART_INTERVAL || "0");

  if (!keepAlive) {
    return false; // Skip processes that don't need to be kept alive
  }

  // Check if process is running
  if (proc.status !== "running") {
    console.log(`⚠️  Process ${proc.name} is not running, restarting...`);
    await restartProcess(proc.name);
    return true;
  }

  // Check memory limit
  if (memoryLimitStr) {
    const memoryLimit = parseMemoryLimit(memoryLimitStr);
    if (memoryLimit > 0) {
      const currentMemory = await getMemoryUsage(proc.pid);
      if (currentMemory > memoryLimit) {
        const currentMB = Math.round(currentMemory / 1024 / 1024);
        const limitMB = Math.round(memoryLimit / 1024 / 1024);
        console.log(
          `💾 Process ${proc.name} (PID: ${proc.pid}) exceeded memory limit: ${currentMB}MB > ${limitMB}MB`,
        );
        await restartProcess(proc.name);
        return true;
      }
    }
  }

  // Check restart interval (in minutes)
  if (restartInterval > 0) {
    const homePath = getHomeDir();
    const lastRestartFile = join(homePath, ".bgr", `${proc.name}-last-restart`);
    let lastRestart = 0;

    if (fs.existsSync(lastRestartFile)) {
      try {
        lastRestart = parseInt(fs.readFileSync(lastRestartFile, "utf8"));
      } catch (error) {
        // If we can't read the file, assume it's time to restart
      }
    }

    const now = Date.now();
    const intervalMs = restartInterval * 60 * 1000;

    if (now - lastRestart > intervalMs) {
      console.log(
        `⏰ Process ${proc.name} reached restart interval (${restartInterval} minutes)`,
      );
      await restartProcess(proc.name);
      fs.writeFileSync(lastRestartFile, now.toString());
      return true;
    }
  }

  return false;
}

async function checkAndRestartProcesses(): Promise<void> {
  const processes = await getAllProcesses();

  if (processes.length === 0) {
    console.log(`ℹ️  No processes found (${new Date().toLocaleTimeString()})`);
    return;
  }

  const monitoredProcesses = processes.filter(
    (p) => p.env.BGR_KEEP_ALIVE === "true",
  );
  const runningProcesses = processes.filter((p) => p.status === "running");
  let restartedCount = 0;

  if (monitoredProcesses.length === 0) {
    console.log(
      `ℹ️  No processes have BGR_KEEP_ALIVE=true (${new Date().toLocaleTimeString()})`,
    );
    return;
  }

  console.log(
    `🔍 Checking ${monitoredProcesses.length} monitored processes...`,
  );

  for (const proc of monitoredProcesses) {
    const wasRestarted = await checkProcess(proc);
    if (wasRestarted) {
      restartedCount++;
    }
  }

  if (restartedCount === 0) {
    console.log(
      `✅ All monitored processes are healthy (${new Date().toLocaleTimeString()})`,
    );
  } else {
    console.log(
      `📊 Status: ${runningProcesses.length - restartedCount} running, ${restartedCount} restarted`,
    );
  }
}

async function main() {
  const checkInterval = parseInt(process.argv[2] || "60") * 1000; // Default to 60 seconds for memory checks

  console.log("🛡️  BGR Multi-Process Guard started");
  console.log(`⏱️  Check interval: ${checkInterval / 1000} seconds`);
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
  console.log(`📋 Monitoring processes with BGR_KEEP_ALIVE=true for:`);
  console.log(`   - Process status (running/stopped)`);
  console.log(`   - Memory limits (BGR_MEMORY_LIMIT env var)`);
  console.log(`   - Restart intervals (BGR_RESTART_INTERVAL env var)`);
  console.log("─".repeat(50));

  while (true) {
    try {
      await checkAndRestartProcesses();
    } catch (error: any) {
      console.error(`💥 Error during check cycle: ${error.message}`);
    }

    await sleep(checkInterval);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 BGR Guard stopped by user");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 BGR Guard terminated");
  process.exit(0);
});

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
