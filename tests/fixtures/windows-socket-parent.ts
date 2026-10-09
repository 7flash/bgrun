import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcess } from "../../src/commands/run";
import { getProcess } from "../../src/db";
const [port, readyFile, hostname = "127.0.0.1"] = process.argv.slice(2);
const server = Bun.serve({
  hostname,
  port: Number(port),
  fetch: () => new Response(String(process.pid)),
});
const workers = await Promise.all(
  [0, 1, 2].map(async (index) => {
    const existing = getProcess(`socket-worker-${index}`);
    if (existing)
      return {
        pid: existing.pid,
        stdout: existing.stdout_path,
        stderr: existing.stderr_path,
      };
    const result = await runProcess({
      name: `socket-worker-${index}`,
      command: "Windows socket inheritance acceptance worker",
      argv: [
        process.execPath,
        join(import.meta.dir, "windows-socket-worker.ts"),
      ],
      directory: import.meta.dir,
      env: { BGR_KEEP_ALIVE: "false" },
      parent: null,
      detached: true,
    });
    return {
      pid: result.process.pid,
      stdout: result.process.stdout_path,
      stderr: result.process.stderr_path,
    };
  }),
);
writeFileSync(
  readyFile!,
  JSON.stringify({ pid: process.pid, port: server.port, workers }),
);