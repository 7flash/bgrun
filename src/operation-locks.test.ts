import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireProcessOperationLock,
  isProcessOperationLocked,
} from "./operation-locks";
import { resolveBgrunRuntime, withBgrunRuntime } from "./runtime-context";

describe("process operation locks", () => {
  test("serialize mutations and recover stale filesystem locks", () => {
    const home = mkdtempSync(join(tmpdir(), "bgrun-lock-test-"));
    const runtime = resolveBgrunRuntime({ home });

    try {
      withBgrunRuntime(runtime, () => {
        const release = acquireProcessOperationLock("api");
        expect(isProcessOperationLocked("api")).toBe(true);
        expect(() => acquireProcessOperationLock("api")).toThrow(
          /already in progress/,
        );

        const runtimeLockDir = join(home, "locks");
        const [scope] = readdirSync(runtimeLockDir);
        const scopeDir = join(runtimeLockDir, scope);
        const [lockName] = readdirSync(scopeDir);
        const lockPath = join(scopeDir, lockName);
        const owner = JSON.parse(readFileSync(lockPath, "utf8"));
        writeFileSync(
          lockPath,
          JSON.stringify({
            ...owner,
            token: "stale",
            pid: 2147483646,
            birth: "",
          }),
        );
        release();

        const releaseRecovered = acquireProcessOperationLock("api");
        expect(isProcessOperationLocked("api")).toBe(true);
        releaseRecovered();
        expect(isProcessOperationLocked("api")).toBe(false);
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
