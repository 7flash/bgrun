import { normalize, resolve } from "node:path";
import { getActiveBgrunRuntime } from "./runtime-context";

export function canonicalPath(value: string): string {
  const normalized = normalize(resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getBgrHome(): string {
  return getActiveBgrunRuntime().home;
}

export function getDatabasePath(): string {
  return getActiveBgrunRuntime().dbPath;
}
