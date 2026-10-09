import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { spawnProcess } from "../../src/process-spawn";
type Worker = { pid: number; stdout: string; stderr: string };
type Ready = { pid: number; port: number; workers: Worker[] };
async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await Bun.sleep(25);
  }
  throw new Error(
    "Timed out waiting for socket inheritance acceptance fixture",
  );
}
function latest(path: string): { pid: number; sequence: number } | undefined {
  if (!existsSync(path)) return;
  // Drop any partially written final line while the worker is actively logging.
  const complete = readFileSync(path, "utf8").split(/\r?\n/).slice(0, -1);
  for (const line of complete.reverse()) {
    try {
      const event = JSON.parse(line);
      if (typeof event.pid === "number" && typeof event.sequence === "number")
        return event;
    } catch {
      /* Startup diagnostics are not worker events. */
    }
  }
}
async function progress(worker: Worker) {
  process.kill(worker.pid, 0);
  await Promise.all(
    [worker.stdout, worker.stderr].map(async (stream) => {
      const before = await until(() => latest(stream));
      expect(before.pid).toBe(worker.pid);
      await until(() => {
        const after = latest(stream);
        return after?.pid === worker.pid && after.sequence > before.sequence
          ? after
          : undefined;
      });
    }),
  );
}
for (const hostname of ["127.0.0.1", "::1"]) {
  (process.platform === "win32" ? test : test.skip)(
    `web restarts immediately on the same ${hostname} port while concurrent workers retain PIDs and both log streams`,
    async () => {
      const home = mkdtempSync(join(tmpdir(), "bgrun-socket-inheritance-"));
      const parents: ReturnType<typeof Bun.spawn>[] = [];
      const workers = new Map<number, Worker>();
      let port = 0;
      try {
        for (let generation = 0; generation <= 3; generation++) {
          const readyFile = join(home, `ready-${generation}.json`);
          const errors = join(home, `parent-${generation}.stderr`);
          // No port polling or bind retries. Restart immediately after prior web exit.
          const parent = Bun.spawn(
            [
              process.execPath,
              join(import.meta.dir, "../fixtures/windows-socket-parent.ts"),
              String(port),
              readyFile,
              hostname,
            ],
            {
              env: {
                ...process.env,
                BGRUN_HOME: home,
                BGRUN_DB: join(home, "state.sqlite"),
                BGR_PROCESS_NAME: "",
                BGR_PARENT_NAME: "",
              },
              stdin: "ignore",
              stdout: "ignore",
              stderr: Bun.file(errors),
            },
          );
          parents.push(parent);
          const ready = await until(() => {
            if (parent.exitCode !== null)
              throw new Error(
                `Web failed to bind/start: ${readFileSync(errors, "utf8")}`,
              );
            return existsSync(readyFile)
              ? (JSON.parse(readFileSync(readyFile, "utf8")) as Ready)
              : undefined;
          });
          expect(ready.pid).toBe(parent.pid);
          if (generation === 0) port = ready.port;
          expect(ready.port).toBe(port);
          expect(ready.workers).toHaveLength(3);
          const address = hostname.includes(":") ? `[${hostname}]` : hostname;
          expect(await (await fetch(`http://${address}:${port}`)).text()).toBe(
            String(parent.pid),
          );
          for (const worker of ready.workers) {
            if (generation === 0) workers.set(worker.pid, worker);
            else expect(workers.has(worker.pid)).toBe(true);
          }
          await Promise.all(ready.workers.map(progress));
          // Kill only the web PID, never the tree. Workers must survive.
          parent.kill(9);
          await parent.exited;
        }
        await Promise.all([...workers.values()].map(progress));
      } finally {
        for (const parent of parents) {
          if (parent.exitCode === null) parent.kill(9);
          await parent.exited;
        }
        for (let generation = 0; generation <= 3; generation++) {
          const readyFile = join(home, `ready-${generation}.json`);
          if (existsSync(readyFile)) {
            const ready = JSON.parse(readFileSync(readyFile, "utf8")) as Ready;
            for (const worker of ready.workers) workers.set(worker.pid, worker);
          }
        }
        for (const pid of workers.keys()) {
          try {
            process.kill(pid, 9);
          } catch {
            /* Already exited. */
          }
        }
        await Bun.sleep(150);
        rmSync(home, { recursive: true, force: true });
      }
    },
    90_000,
  );
}

(process.platform === "win32" ? test : test.skip)(
  "Windows handle whitelist excludes an explicitly inheritable unrelated handle",
  async () => {
    const api = dlopen("kernel32.dll", {
      CreateEventW: {
        args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr],
        returns: FFIType.u64,
      },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    });
    // SECURITY_ATTRIBUTES is 24 bytes on Windows x64/arm64. bInheritHandle=TRUE.
    const attributes = Buffer.alloc(24);
    attributes.writeUInt32LE(24, 0);
    attributes.writeInt32LE(1, 16);
    const handle = api.symbols.CreateEventW(ptr(attributes), 1, 1, null);
    expect(BigInt(handle)).not.toBe(0n);
    try {
      const argv = [
        process.execPath,
        join(import.meta.dir, "../fixtures/windows-socket-handle.ts"),
      ];
      const env = { ...process.env, BGR_TEST_HANDLE: String(handle) };
      // The positive control proves that this sentinel really can leak through
      // the installed Bun launcher, independent of Bun's socket inheritability.
      const baseline = Bun.spawn(argv, {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const baselineOutput = await new Response(baseline.stdout).text();
      expect(await baseline.exited).toBe(0);
      expect(JSON.parse(baselineOutput).result).toBe(0); // Signaled event inherited.
      const protectedChild = await spawnProcess(argv, {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const protectedOutput = await new Response(protectedChild.stdout).text();
      expect(await protectedChild.exited).toBe(0);
      expect(JSON.parse(protectedOutput).result).toBe(0xffffffff); // WAIT_FAILED.
    } finally {
      api.symbols.CloseHandle(handle);
      api.close();
    }
  },
  15_000,
);