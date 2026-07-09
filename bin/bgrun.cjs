#!/usr/bin/env node
"use strict";

/**
 * Node/npm compatibility shim for bgrun.
 *
 * Why this exists:
 * - `npx bgrun` executes package bins with Node.
 * - The real bgrun CLI and SDK require Bun.
 * - This shim gives a clear error when Bun is missing, and delegates to
 *   the real Bun CLI when Bun is available.
 *
 * Important:
 * - Do not delegate with `bun x bgrun`; that can recurse back into this shim.
 * - Always execute the package-local `dist/index.js` directly with Bun.
 */

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

function candidateBunCommands() {
  const values = [];

  if (process.env.BUN_EXECUTABLE) values.push(process.env.BUN_EXECUTABLE);
  if (process.env.BUN) values.push(process.env.BUN);

  values.push(process.platform === "win32" ? "bun.exe" : "bun");
  values.push("bun");

  return [...new Set(values.filter(Boolean))];
}

function findBun() {
  for (const candidate of candidateBunCommands()) {
    const result = spawnSync(candidate, ["--version"], {
      stdio: "ignore",
      shell: false,
    });

    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function printMissingBunError() {
  console.error("");
  console.error("bgrun requires the Bun runtime.");
  console.error("");
  console.error("You ran bgrun through Node/npm, for example:");
  console.error("  npx bgrun");
  console.error("");
  console.error("Install Bun, then run:");
  console.error("  bunx bgrun");
  console.error("");
  console.error("Or use npm/npx again after Bun is on PATH:");
  console.error("  npx bgrun");
  console.error("");
  console.error("Bun install docs:");
  console.error("  https://bun.sh/docs/installation");
  console.error("");
}

const bun = findBun();
if (!bun) {
  printMissingBunError();
  process.exit(1);
}

const cliPath = path.resolve(__dirname, "..", "dist", "index.js");

if (!existsSync(cliPath)) {
  console.error("");
  console.error("bgrun package is missing its built CLI artifact:");
  console.error(`  ${cliPath}`);
  console.error("");
  console.error("This usually means the package was published without running:");
  console.error("  bun run build");
  console.error("");
  process.exit(1);
}

const result = spawnSync(bun, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  cwd: process.cwd(),
  shell: false,
});

if (result.error) {
  console.error("");
  console.error(`Failed to start bgrun with Bun: ${result.error.message}`);
  console.error("");
  process.exit(1);
}

process.exit(result.status ?? 1);
