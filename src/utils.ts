
export function parseEnvString(envString: string): Record<string, string> {
    const env: Record<string, string> = {};
    envString.split(",").forEach(pair => {
        const [key, value] = pair.split("=");
        if (key && value) env[key] = value;
    });
    return env;
}


export function calculateRuntime(startTime: string): string {
    const start = new Date(startTime).getTime();
    const now = new Date().getTime();
    const diffInMinutes = Math.floor((now - start) / (1000 * 60));
    return `${diffInMinutes} minutes`;
}

const INTERNAL_MANAGED_ENV_KEYS = ["BUN_PORT", "BGR_STDOUT", "BGR_STDERR"] as const;

function prependPathEntry(existingPath: string | undefined, entry: string): string {
    if (!existingPath) return entry;
    const parts = existingPath.split(delimiter).filter(Boolean);
    const normalizedEntry = process.platform === "win32" ? entry.toLowerCase() : entry;
    const deduped = parts.filter(part => {
        const normalizedPart = process.platform === "win32" ? part.toLowerCase() : part;
        return normalizedPart !== normalizedEntry;
    });
    return [entry, ...deduped].join(delimiter);
}

export function parseCommandEnv(command: string): Record<string, string> {
    const env: Record<string, string> = {};
    const trimmed = command.trim();

    const windowsSegments = trimmed.split(/&&/).map(segment => segment.trim());
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
            const eqIdx = pair.indexOf('=');
            if (eqIdx <= 0) continue;
            const key = pair.slice(0, eqIdx);
            const value = pair.slice(eqIdx + 1);
            if (key) env[key] = value;
        }
    }

    return env;
}

export function getDeclaredPort(processEnv: Record<string, string>, command?: string): number | null {
    const mergedEnv = { ...(command ? parseCommandEnv(command) : {}), ...processEnv };
    const raw = mergedEnv.PORT || mergedEnv.BUN_PORT || '';
    const parsed = parseInt(raw, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : null;
}

export function buildManagedProcessEnv(
    parentEnv: Record<string, string | undefined>,
    processEnv: Record<string, string> = {},
): Record<string, string> {
    const sanitizedParentEnv: Record<string, string> = {};

    for (const [key, value] of Object.entries(parentEnv)) {
        if (value === undefined) continue;
        if (INTERNAL_MANAGED_ENV_KEYS.includes(key as typeof INTERNAL_MANAGED_ENV_KEYS[number])) continue;
        sanitizedParentEnv[key] = value;
    }

    // bunx prepends transient shims like project/node_modules/.bin/bun.exe ahead of the real
    // Bun install. Managed children must prefer the actual Bun runtime when invoking `bun`.
    const bunDir = dirname(process.execPath);
    sanitizedParentEnv.PATH = prependPathEntry(sanitizedParentEnv.PATH, bunDir);

    return { ...sanitizedParentEnv, ...processEnv };
}

export function stringifyEnvString(env: Record<string, string>): string {
    return Object.entries(env).map(([key, value]) => `${key}=${value}`).join(",");
}

const WATCHER_PREFIX = "bgr-watch-";

export function getWatcherProcessName(targetName: string): string {
    return `${WATCHER_PREFIX}${encodeURIComponent(targetName)}`;
}

export function getWatchedProcessName(watcherName: string): string | null {
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
    return name === "bgr-dashboard" || name === "bgr-guard" || isWatcherProcessName(name);
}

// Re-export platform utils for backward compatibility and convenience
export { isProcessRunning } from "./platform";

import * as fs from "fs";
import * as os from "os";
import chalk from "chalk";
import { delimiter, dirname, join } from "path";

function getOperationLockPath(name: string): string {
    return join(os.homedir(), ".bgr", `${name}.operation.lock`);
}

export function acquireProcessOperationLock(name: string): () => void {
    const lockPath = getOperationLockPath(name);
    fs.mkdirSync(join(os.homedir(), ".bgr"), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, time: Date.now() }));

    let released = false;
    return () => {
        if (released) return;
        released = true;
        try { fs.unlinkSync(lockPath); } catch { }
    };
}

export function isProcessOperationLocked(name: string): boolean {
    return fs.existsSync(getOperationLockPath(name));
}

// Read version at runtime instead of using macros (macros crash on Windows)
export async function getVersion(): Promise<string> {
    try {
        const pkgPath = join(import.meta.dir, '../package.json');
        const pkg = await Bun.file(pkgPath).json();
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}


export function validateDirectory(directory: string) {
    if (!directory || !fs.existsSync(directory)) {
        // Throw instead of process.exit() — lets dashboard API handlers catch gracefully
        throw new Error(`Directory not found or invalid: '${directory}'`);
    }
}

export function tailFile(path: string, prefix: string, colorFn: (s: string) => string, lines?: number): () => void {
    let position = 0;
    let lastPartial = '';

    if (!fs.existsSync(path)) {
        return () => { };
    }

    const fd = fs.openSync(path, 'r');

    const printNewContent = () => {
        try {
            const stats = fs.statSync(path);
            if (stats.size <= position) return;

            const buffer = Buffer.alloc(stats.size - position);
            fs.readSync(fd, buffer, 0, buffer.length, position);

            let content = buffer.toString();
            content = lastPartial + content;
            lastPartial = '';

            const lineArray = content.split(/\r?\n/);
            if (!content.endsWith('\n')) {
                lastPartial = lineArray.pop() || '';
            }

            lineArray.forEach(line => {
                if (line) {
                    console.log(colorFn(prefix + line));
                }
            });

            position = stats.size;
        } catch (e) {
            // ignore read errors
        }
    };

    const watcher = fs.watch(path, { persistent: true }, (event) => {
        if (event === 'change') {
            printNewContent();
        }
    });

    printNewContent(); // Check immediately

    return () => {
        watcher.close();
        try { fs.closeSync(fd); } catch { }
    };
}
