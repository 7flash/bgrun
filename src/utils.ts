import { createFileFollower } from "./file-follower";
import { readLogTail } from "./log-io";
export { parseEnvString, stringifyEnvString } from "./env";
export {
  acquireProcessOperationLock,
  isProcessOperationLocked,
} from "./operation-locks";
export function calculateRuntime(startTime: string): string {
  const start = new Date(startTime).getTime();
  const now = new Date().getTime();
  if (!Number.isFinite(start)) return "unknown";
  const diffInMinutes = Math.max(0, Math.floor((now - start) / (1000 * 60)));
  return `${diffInMinutes} minutes`;
}
const INTERNAL_MANAGED_ENV_KEYS = [
  "BUN_PORT",
  "BGR_STDOUT",
  "BGR_STDERR",
  "BGR_PARENT_NAME",
  "BGR_PROCESS_NAME",
] as const;
function prependPathEntry(
  existingPath: string | undefined,
  entry: string,
): string {
  if (!existingPath) return entry;
  const parts = existingPath.split(delimiter).filter(Boolean);
  const normalizedEntry =
    process.platform === "win32" ? entry.toLowerCase() : entry;
  const deduped = parts.filter((part) => {
    const normalizedPart =
      process.platform === "win32" ? part.toLowerCase() : part;
    return normalizedPart !== normalizedEntry;
  });
  return [entry, ...deduped].join(delimiter);
}
export function parseCommandEnv(command: string): Record<string, string> {
  const env: Record<string, string> = {};
  const trimmed = command.trim();
  const windowsSegments = trimmed.split(/&&/).map((segment) => segment.trim());
  for (const segment of windowsSegments) {
    const match = segment.match(/^set\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/i);
    if (!match) break;
    env[match[1]] = match[2].trim();
  }
  const unixPrefixRegex = /^(?:([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)\s+)+/;
  const unixPrefix = trimmed.match(unixPrefixRegex);
  if (unixPrefix) {
    const pairs = unixPrefix[0].trim().split(/\s+/);
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = pair.slice(0, eqIdx);
      const value = pair.slice(eqIdx + 1);
      if (key) env[key] = value;
    }
  }
  return env;
}
export function getDeclaredPort(
  processEnv: Record<string, string>,
  command?: string,
): number | null {
  const mergedEnv = {
    ...processEnv,
    ...(command ? parseCommandEnv(command) : {}),
  };
  const raw = mergedEnv.PORT || mergedEnv.BUN_PORT || "";
  const parsed = Number(raw);
  return /^\d+$/.test(raw) &&
    Number.isSafeInteger(parsed) &&
    parsed >= 1 &&
    parsed <= 65535
    ? parsed
    : null;
}
export function buildManagedProcessEnv(
  parentEnv: Record<string, string | undefined>,
  processEnv: Record<string, string> = {},
  removed: readonly string[] = [],
): Record<string, string> {
  const sanitizedParentEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined || removed.includes(key)) continue;
    if (
      INTERNAL_MANAGED_ENV_KEYS.includes(
        key as (typeof INTERNAL_MANAGED_ENV_KEYS)[number],
      )
    )
      continue;
    sanitizedParentEnv[key] = value;
  }
  const bunDir = dirname(process.execPath);
  sanitizedParentEnv.PATH = prependPathEntry(sanitizedParentEnv.PATH, bunDir);
  return { ...sanitizedParentEnv, ...processEnv };
}
const WATCHER_PREFIX = "bgr-watch-";
const COMPACT_WATCHER_PREFIX = "bgr-watch64-";
export function getWatcherProcessName(targetName: string): string {
  const readable = `${WATCHER_PREFIX}${encodeURIComponent(targetName)}`;
  return Buffer.byteLength(readable) <= 160
    ? readable
    : `${COMPACT_WATCHER_PREFIX}${Buffer.from(targetName).toString("base64url")}`;
}
export function getWatchedProcessName(watcherName: string): string | null {
  if (watcherName.startsWith(COMPACT_WATCHER_PREFIX)) {
    const encoded = watcherName.slice(COMPACT_WATCHER_PREFIX.length);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded && Buffer.from(decoded).toString("base64url") === encoded
      ? decoded
      : null;
  }
  if (!watcherName.startsWith(WATCHER_PREFIX)) return null;
  try {
    return decodeURIComponent(watcherName.slice(WATCHER_PREFIX.length));
  } catch {
    return null;
  }
}
export function isWatcherProcessName(name: string): boolean {
  return getWatchedProcessName(name) !== null;
}
export function isInternalProcessName(name: string): boolean {
  return (
    name === "bgr-dashboard" ||
    name === "bgr-guard" ||
    isWatcherProcessName(name)
  );
}
export { isProcessRunning } from "./platform";
import * as fs from "fs";
import chalk from "chalk";
import { delimiter, dirname, join } from "path";
export function getVersionSync(): string {
  try {
    const pkgPath = join(import.meta.dir, "../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}
export async function getVersion(): Promise<string> {
  return getVersionSync();
}
export function validateDirectory(directory: string) {
  if (
    !directory ||
    !fs.existsSync(directory) ||
    !fs.statSync(directory).isDirectory()
  ) {
    throw new Error(`Directory not found or invalid: '${directory}'`);
  }
}
export function tailFile(
  path: string,
  prefix: string,
  colorFn: (s: string) => string,
  lines?: number,
): () => void {
  let offset = 0;
  if (fs.existsSync(path)) {
    const initial = readLogTail(path, lines);
    if (initial) process.stdout.write(colorFn(prefix + initial));
    offset = fs.statSync(path).size;
  }
  const follower = createFileFollower(path, offset);
  const timer = setInterval(() => {
    try {
      const chunk = follower.read();
      if (chunk) process.stdout.write(colorFn(prefix + chunk));
    } catch (error) {
      console.warn(`Cannot follow '${path}': ${error}`);
    }
  }, 250);
  return () => clearInterval(timer);
}
