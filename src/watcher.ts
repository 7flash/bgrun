import { basename, join } from "path";
import { addHistoryEntry, db, getProcess, insertProcess, removeProcessByName, retryDatabaseOperation } from "./db";
import { findChildPid, getHomeDir, getShellCommand, isProcessRunning, psExec, terminateProcess } from "./platform";
import { handleRun } from "./commands/run";
import {
    acquireProcessOperationLock,
    getWatchedProcessName,
    getWatcherProcessName,
    isProcessOperationLocked,
    isInternalProcessName,
    parseEnvString,
    stringifyEnvString,
} from "./utils";

const DEFAULT_INTERVAL_MS = 5_000;
const CRASH_THRESHOLD = 5;
const MAX_BACKOFF_MS = 5 * 60_000;
const STABILITY_WINDOW_MS = 120_000;

function getWatcherLogPaths(watcherName: string) {
    const homePath = getHomeDir();
    return {
        stdoutPath: join(homePath, ".bgr", `${watcherName}-out.txt`),
        stderrPath: join(homePath, ".bgr", `${watcherName}-err.txt`),
    };
}

function quoteArg(value: string): string {
    return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

async function findDetachedWatcherPid(targetName: string): Promise<number | null> {
    if (process.platform !== "win32") return null;

    const escaped = targetName.replace(/'/g, "''");
    const result = await psExec(
        `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | Where-Object { $_.CommandLine -like '*--_watch-process*' -and $_.CommandLine -like '*${escaped}*' } | Sort-Object -Property CreationDate -Descending | Select-Object -First 1 -ExpandProperty ProcessId`,
        4000,
    );
    const pid = parseInt(result.trim(), 10);
    return !isNaN(pid) && pid > 0 ? pid : null;
}

function getInternalWatcherCommand(targetName: string): { storedCommand: string; spawnCommand: string } {
    const currentEntry = process.argv[1] || "";
    const currentBase = basename(currentEntry);
    const runtimeEntry = currentBase === "index.js"
        ? join(import.meta.dir, "..", "index.js")
        : join(import.meta.dir, "..", "index.ts");

    const quotedTarget = quoteArg(targetName);
    return {
        storedCommand: `bgrun --_watch-process ${quotedTarget}`,
        spawnCommand: `bun run ${quoteArg(runtimeEntry)} --_watch-process ${quotedTarget}`,
    };
}

export async function ensureProcessWatcher(targetName: string): Promise<void> {
    if (!targetName || isInternalProcessName(targetName)) return;

    const proc = getProcess(targetName);
    if (!proc) return;

    const env = parseEnvString(proc.env || "");
    if (env.BGR_KEEP_ALIVE !== "true") {
        await stopProcessWatcher(targetName);
        return;
    }

    const watcherName = getWatcherProcessName(targetName);
    const existingWatcher = getProcess(watcherName);
    if (existingWatcher && await isProcessRunning(existingWatcher.pid, existingWatcher.command)) {
        return;
    }

    if (existingWatcher) {
        await retryDatabaseOperation(() => removeProcessByName(watcherName));
    }

    const { stdoutPath, stderrPath } = getWatcherLogPaths(watcherName);
    await Bun.write(stdoutPath, "");
    await Bun.write(stderrPath, "");

    const { storedCommand, spawnCommand } = getInternalWatcherCommand(targetName);
    const newProcess = Bun.spawn(getShellCommand(spawnCommand), {
        env: {
            ...Bun.env,
            BGR_STDOUT: stdoutPath,
            BGR_STDERR: stderrPath,
        },
        cwd: getHomeDir(),
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
    } as any);

    newProcess.unref();
    await Bun.sleep(1000);

    let actualPid = await findChildPid(newProcess.pid);
    if (!(await isProcessRunning(actualPid))) {
        const detachedPid = await findDetachedWatcherPid(targetName);
        if (detachedPid) actualPid = detachedPid;
    }

    await retryDatabaseOperation(() =>
        insertProcess({
            pid: actualPid,
            workdir: getHomeDir(),
            command: storedCommand,
            name: watcherName,
            env: stringifyEnvString({ BGR_KEEP_ALIVE: "false", BGR_WATCH_TARGET: targetName }),
            configPath: "",
            stdout_path: stdoutPath,
            stderr_path: stderrPath,
        }),
    );
}

export async function stopProcessWatcher(targetName: string): Promise<void> {
    const watcherName = getWatcherProcessName(targetName);
    const watcherProc = getProcess(watcherName);
    if (!watcherProc) return;

    if (await isProcessRunning(watcherProc.pid, watcherProc.command)) {
        await terminateProcess(watcherProc.pid, true);
    }

    await retryDatabaseOperation(() => removeProcessByName(watcherName));
}

export async function syncProcessWatcher(targetName: string, env: Record<string, string>): Promise<void> {
    if (!targetName || isInternalProcessName(targetName)) return;

    if (env.BGR_KEEP_ALIVE === "true") {
        await ensureProcessWatcher(targetName);
    } else {
        await stopProcessWatcher(targetName);
    }
}

function getBackoffMs(restartCount: number): number {
    if (restartCount <= CRASH_THRESHOLD) return 0;
    const exponent = restartCount - CRASH_THRESHOLD;
    return Math.min(30_000 * Math.pow(2, exponent - 1), MAX_BACKOFF_MS);
}

async function cleanupWatcher(targetName: string) {
    const watcherName = getWatcherProcessName(targetName);
    await retryDatabaseOperation(() => removeProcessByName(watcherName));
}

export async function startProcessWatcher(targetName: string, intervalMs: number = DEFAULT_INTERVAL_MS) {
    const watcherName = getWatcherProcessName(targetName);
    const releaseWatcherLock = acquireProcessOperationLock(watcherName);
    let restartCount = 0;
    let nextRestartAt = 0;
    let lastSeenAliveAt = 0;

    try {
        console.log(`[watcher] Watching "${targetName}" every ${Math.round(intervalMs / 1000)}s`);

        while (true) {
            const proc = getProcess(targetName);
            if (!proc) {
                console.log(`[watcher] Target "${targetName}" removed; exiting watcher`);
                break;
            }

            const env = parseEnvString(proc.env || "");
            if (env.BGR_KEEP_ALIVE !== "true") {
                console.log(`[watcher] Guard disabled for "${targetName}"; exiting watcher`);
                break;
            }

            if (proc.pid <= 0 || isProcessOperationLocked(targetName)) {
                await Bun.sleep(intervalMs);
                continue;
            }

            const alive = await isProcessRunning(proc.pid, proc.command);
            if (!alive) {
                const now = Date.now();
                if (now < nextRestartAt) {
                    await Bun.sleep(intervalMs);
                    continue;
                }

                try {
                    console.log(`[watcher] Restarting "${targetName}" after detected crash`);
                    await handleRun({
                        action: "run",
                        name: targetName,
                        force: true,
                        remoteName: "",
                    });
                    restartCount++;
                    const backoffMs = getBackoffMs(restartCount);
                    nextRestartAt = backoffMs > 0 ? now + backoffMs : 0;
                    lastSeenAliveAt = 0;
                    addHistoryEntry(targetName, "guard_restart", proc.pid, { by: watcherName, count: restartCount, backoffMs });
                } catch (err: any) {
                    addHistoryEntry(targetName, "guard_restart_failed", proc.pid, { by: watcherName, error: err?.message || String(err) });
                    console.error(`[watcher] Failed to restart "${targetName}": ${err.message}`);
                }
            } else if (restartCount > 0) {
                const now = Date.now();
                if (!lastSeenAliveAt) {
                    lastSeenAliveAt = now;
                } else if (now - lastSeenAliveAt >= STABILITY_WINDOW_MS) {
                    restartCount = 0;
                    nextRestartAt = 0;
                    lastSeenAliveAt = 0;
                }
            }

            await Bun.sleep(intervalMs);
        }
    } finally {
        releaseWatcherLock();
        await cleanupWatcher(targetName);
    }
}

export function getGuardRestartCounts() {
    const counts = new Map<string, number>();
    const entries = db.history.select().where({ event: "guard_restart" }).all();
    for (const entry of entries) {
        counts.set(entry.process_name, (counts.get(entry.process_name) || 0) + 1);
    }
    return counts;
}

export function getRecentGuardEvents(limit = 100) {
    const rows = db.history.select()
        .orderBy("timestamp", "desc")
        .limit(limit * 4)
        .all()
        .filter((row: any) => row.event === "guard_restart" || row.event === "guard_restart_failed")
        .slice(0, limit);

    return rows.map((row: any) => ({
        time: new Date(row.timestamp).getTime(),
        name: row.process_name,
        action: "restart",
        success: row.event === "guard_restart",
    }));
}
