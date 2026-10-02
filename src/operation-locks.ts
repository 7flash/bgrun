import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { canonicalPath } from "./paths";
import { getActiveBgrunRuntime } from "./runtime-context";
import { getProcessBirthId } from "./process-identity";

const processLocks = new Set<string>();
const checkoutLocks = new Set<string>();

type ProcessLockOwner = {
  token: string;
  pid: number;
  birth: string;
  name: string;
  createdAt: string;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function processLockPath(name: string): string {
  const runtime = getActiveBgrunRuntime();
  const dir = join(runtime.home, "locks", hash(runtime.key));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${hash(name)}.lock`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== "ESRCH";
  }
}

function readOwner(path: string): ProcessLockOwner | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (
      !value ||
      typeof value.token !== "string" ||
      !Number.isSafeInteger(value.pid) ||
      typeof value.birth !== "string" ||
      typeof value.name !== "string"
    ) {
      return null;
    }
    return value as ProcessLockOwner;
  } catch {
    return null;
  }
}

function ownerStillActive(owner: ProcessLockOwner | null): boolean {
  if (!owner) return true;
  if (!isPidAlive(owner.pid)) return false;
  if (!owner.birth) return true;
  const currentBirth = getProcessBirthId(owner.pid);
  if (!currentBirth) return true;
  return currentBirth === owner.birth;
}

function removeLockIfOwned(path: string, token: string): void {
  const owner = readOwner(path);
  if (!owner || owner.token !== token) return;
  try {
    unlinkSync(path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function acquireProcessOperationLock(name: string): () => void {
  const runtime = getActiveBgrunRuntime();
  const key = `${runtime.key}:${name}`;
  if (processLocks.has(key)) {
    throw new Error(`Process '${name}' operation is already in progress`);
  }

  const path = processLockPath(name);
  const owner: ProcessLockOwner = {
    token: randomUUID(),
    pid: process.pid,
    birth: getProcessBirthId(process.pid),
    name,
    createdAt: new Date().toISOString(),
  };

  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    let fd: number | undefined;
    try {
      fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(owner), "utf8");
      acquired = true;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readOwner(path);
      if (ownerStillActive(existing)) {
        throw new Error(`Process '${name}' operation is already in progress`);
      }
      try {
        unlinkSync(path);
      } catch (unlinkError: any) {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  if (!acquired) {
    throw new Error(`Could not acquire process lock for '${name}'`);
  }

  processLocks.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    processLocks.delete(key);
    removeLockIfOwned(path, owner.token);
  };
}

export function isProcessOperationLocked(name: string): boolean {
  const runtime = getActiveBgrunRuntime();
  const key = `${runtime.key}:${name}`;
  if (processLocks.has(key)) return true;
  const path = processLockPath(name);
  const owner = readOwner(path);
  if (!owner) return false;
  if (ownerStillActive(owner)) return true;
  try {
    unlinkSync(path);
  } catch (error: any) {
    if (error?.code !== "ENOENT") return true;
  }
  return false;
}

function acquire(set: Set<string>, key: string, label: string): () => void {
  if (set.has(key))
    throw new Error(`${label} operation is already in progress`);
  set.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(key);
  };
}

export function acquireCheckoutOperationLock(directory: string): () => void {
  const key = canonicalPath(directory);
  return acquire(checkoutLocks, key, `Checkout '${directory}'`);
}
