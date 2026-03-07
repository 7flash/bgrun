#!/usr/bin/env bun
/**
 * Process Guard for BGR
 * Monitors a process and automatically restarts it if it stops
 * 
 * Usage: bun guard.ts <process-name> [check-interval-seconds]
 */

import { $, sleep } from "bun";

async function main() {
  const processName = process.argv[2];
  const checkInterval = parseInt(process.argv[3] || "30") * 1000;

  if (!processName) {
    console.error("Error: Process name required");
    console.error("Usage: bun guard.ts <process-name> [check-interval-seconds]");
    process.exit(1);
  }

  console.log(`Monitoring process "${processName}"`);
  console.log(`Check interval: ${checkInterval / 1000} seconds`);

  while (true) {
    try {
      const result = await $`bgr ${processName}`.quiet().nothrow();

      if (result.stdout.includes("○ Stopped") || result.exitCode !== 0) {
        console.log(`Process "${processName}" is not running. Restarting...`);

        const restartResult = await $`bgr ${processName} --restart --force`.nothrow();

        if (restartResult.exitCode === 0) {
          console.log(`Restarted "${processName}"`);
        } else {
          console.error(`Failed to restart "${processName}"`);
          console.error(restartResult.stderr);
        }
      } else {
        console.log(`Process "${processName}" is running (${new Date().toLocaleTimeString()})`);
      }
    } catch (error) {
      console.error(`Error checking process: ${(error as Error).message}`);
    }

    await sleep(checkInterval);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});