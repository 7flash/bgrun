"use strict";

const message = [
  "bgrun SDK requires the Bun runtime.",
  "",
  "This package uses Bun-specific APIs and cannot be imported from Node.js or Deno.",
  "",
  "Use one of these instead:",
  "  bunx bgrun",
  "  bun run your-script.ts",
  "",
  "For a Node/npm command, `npx bgrun` is supported only as a launcher shim;",
  "it still requires Bun to be installed on PATH.",
].join("\n");

throw new Error(message);
