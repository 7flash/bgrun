/**
 * BGR Dashboard Server + Built-in Process Guard
 * 
 * Uses Melina.js to serve the dashboard app with file-based routing.
 * All API endpoints and page rendering are handled by the dashboard/app/ directory.
 * 
 * v3.0: Built-in guard loop — the dashboard now monitors ALL registered
 * processes and auto-restarts any that die. This eliminates the need for
 * external guard scripts. The dashboard itself survives because bgrun
 * registers it as a managed process on launch.
 * 
 * Port selection is handled entirely by Melina:
 *   - If BUN_PORT env var is set → uses that (explicit, will fail if busy)
 *   - Otherwise → defaults to 3000, falls back to next available if busy
 */
import path from 'path';
import { getAllProcesses, getProcess, addHistoryEntry } from './db';
import { isProcessRunning } from './platform';
import { handleRun } from './commands/run';
import { parseEnvString } from './utils';

const GUARD_INTERVAL_MS = 30_000; // Check every 30 seconds
const GUARD_SKIP_NAMES = new Set(['bgr-dashboard', 'bgr-guard']); // Don't try to restart ourselves or external guard

// In-memory guard restart counter and timestamps (persists across module re-evaluations)
const _g = globalThis as any;
if (!_g.__bgrGuardRestartCounts) _g.__bgrGuardRestartCounts = new Map<string, number>();
if (!_g.__bgrGuardNextRestartTime) _g.__bgrGuardNextRestartTime = new Map<string, number>();
if (!_g.__bgrGuardEvents) _g.__bgrGuardEvents = [] as { time: number; name: string; action: string; success: boolean }[];
export const guardRestartCounts: Map<string, number> = _g.__bgrGuardRestartCounts;
const guardNextRestartTime: Map<string, number> = _g.__bgrGuardNextRestartTime;
export const guardEvents: { time: number; name: string; action: string; success: boolean }[] = _g.__bgrGuardEvents;

/** Try to free a port from zombie processes (dead PIDs holding sockets) */
async function cleanupPort(port: number): Promise<number> {
    if (process.platform !== 'win32') return port;
    try {
        const proc = Bun.spawn(['powershell', '-NoProfile', '-Command',
            `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
        ], { stdout: 'pipe', stderr: 'pipe' });
        const text = await new Response(proc.stdout).text();
        const pid = parseInt(text.trim(), 10);
        if (!pid || pid === process.pid) return port;

        // Check if the owning process is actually dead
        const checkProc = Bun.spawn(['powershell', '-NoProfile', '-Command',
            `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`
        ], { stdout: 'pipe', stderr: 'pipe' });
        const checkText = await new Response(checkProc.stdout).text();
        if (checkText.trim()) {
            // Process is alive — kill it to reclaim the port
            console.log(`[server] Killing PID ${pid} holding port ${port}`);
            Bun.spawn(['taskkill', '/F', '/PID', String(pid)], { stdout: 'pipe', stderr: 'pipe' });
            await Bun.sleep(1000);
            return port;
        } else {
            // Process is dead but socket is zombie — use fallback port
            const fallback = port + 1;
            console.log(`[server] ⚠ Port ${port} held by zombie PID ${pid} — falling back to port ${fallback}`);
            return fallback;
        }
    } catch { return port; /* best-effort cleanup */ }
}

let _originalPort = 3000;
let _currentPort = 3000;

export async function startServer() {
    // Dynamic import to avoid melina's side-effect console.log at bundle load time
    const { start } = await import('melina');
    const appDir = path.join(import.meta.dir, '../dashboard/app');

    // Only pass port when BUN_PORT is explicitly set.
    // When omitted, Melina defaults to 3000 with auto-fallback to next available port.
    const requestedPort = process.env.BUN_PORT ? parseInt(process.env.BUN_PORT, 10) : 3000;
    _originalPort = requestedPort;

    // Clean up zombie port bindings before starting — may return a different fallback port
    const resolvedPort = await cleanupPort(requestedPort);
    _currentPort = resolvedPort;

    // Pass port explicitly if user requested one OR if we had to fallback
    const needsExplicitPort = process.env.BUN_PORT || resolvedPort !== requestedPort;
    await start({
        appDir,
        defaultTitle: 'bgrun Dashboard - Process Manager',
        globalCss: path.join(appDir, 'globals.css'),
        ...(needsExplicitPort && { port: resolvedPort }),
    });

    // Start the built-in process guard
    startGuard();

    // Start log rotation (prevents unbounded log file growth)
    const { startLogRotation } = await import('./log-rotation');
    startLogRotation(() => getAllProcesses());

    // Start sticky port checker - periodically try original port if we're on a fallback
    if (resolvedPort !== requestedPort) {
        startStickyPortChecker();
    }
}

function startStickyPortChecker() {
    const CHECK_INTERVAL_MS = 60_000; // Check every 60 seconds
    console.log(`[server] Starting sticky port checker (original: ${_originalPort}, current: ${_currentPort})`);

    setInterval(async () => {
        if (_currentPort === _originalPort) return; // Already on original port

        try {
            const proc = Bun.spawn(['powershell', '-NoProfile', '-Command',
                `Get-NetTCPConnection -LocalPort ${_originalPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`
            ], { stdout: 'pipe', stderr: 'pipe' });
            const text = await new Response(proc.stdout).text();
            const pid = parseInt(text.trim(), 10);

            if (!pid) {
                console.log(`[server] ✓ Original port ${_originalPort} is now available! Consider restarting to reclaim it.`);
                _currentPort = _originalPort;
            }
        } catch { /* best-effort */ }
    }, CHECK_INTERVAL_MS);
}

/**
 * Built-in Process Guard
 * 
 * Runs as a background loop inside the dashboard process.
 * Every GUARD_INTERVAL_MS, checks processes with BGR_KEEP_ALIVE=true
 * in their env and auto-restarts any that died.
 * 
 * Only guarded processes (opted-in via dashboard toggle or env var) are
 * monitored. Other processes are left alone even if they crash.
 * 
 * Toggle guard per-process:
 *   - Dashboard UI: click the shield icon on any process row
 *   - CLI: set BGR_KEEP_ALIVE=true in the process env/config
 */
function startGuard() {
    console.log(`[guard] ✓ Built-in process guard started (checking every ${GUARD_INTERVAL_MS / 1000}s)`);

    setInterval(async () => {
        try {
            const processes = getAllProcesses();
            if (processes.length === 0) return;

            for (const proc of processes) {
                // Skip the dashboard itself
                if (GUARD_SKIP_NAMES.has(proc.name)) continue;

                // Only guard processes with BGR_KEEP_ALIVE=true
                const env = proc.env ? parseEnvString(proc.env) : {};
                if (env.BGR_KEEP_ALIVE !== 'true') continue;

                const alive = await isProcessRunning(proc.pid, proc.command);
                if (!alive) {
                    const now = Date.now();
                    const nextRestart = guardNextRestartTime.get(proc.name) || 0;
                    if (now < nextRestart) continue; // Still in backoff period

                    console.log(`[guard] ⚠ Guarded process "${proc.name}" (PID ${proc.pid}) is dead, restarting...`);
                    let success = false;
                    try {
                        await handleRun({
                            action: 'run',
                            name: proc.name,
                            force: true,
                            remoteName: '',
                        });
                        success = true;

                        // Track restart count
                        const prevCount = guardRestartCounts.get(proc.name) || 0;
                        const newCount = prevCount + 1;
                        guardRestartCounts.set(proc.name, newCount);

                        // Record in history database
                        try {
                            addHistoryEntry(proc.name, 'restart', undefined, { by: 'guard', count: newCount });
                        } catch { /* ignore history errors */ }

                        // Record event for dashboard
                        guardEvents.unshift({ time: now, name: proc.name, action: 'restart', success: true });
                        if (guardEvents.length > 100) guardEvents.pop();

                        // Exponential backoff if it crashes repeatedly (more than 5 times)
                        if (newCount > 5) {
                            const backoffSeconds = Math.min(30 * Math.pow(2, newCount - 6), 300); // 30s, 60s, 120s, up to 5 mins
                            guardNextRestartTime.set(proc.name, Date.now() + (backoffSeconds * 1000));
                            console.log(`[guard] ✓ Restarted "${proc.name}" (restart #${newCount}). Crash loop detected: next check delayed by ${backoffSeconds}s.`);
                        } else {
                            console.log(`[guard] ✓ Restarted "${proc.name}" (restart #${newCount})`);
                        }
                    } catch (err: any) {
                        console.error(`[guard] ✗ Failed to restart "${proc.name}": ${err.message}`);
                        guardEvents.unshift({ time: now, name: proc.name, action: 'restart', success: false });
                        if (guardEvents.length > 100) guardEvents.pop();
                    }
                } else {
                    // Reset counter if process has been stable (alive at least once during check)
                    const prevCount = guardRestartCounts.get(proc.name) || 0;
                    if (prevCount > 0) {
                        const nextRestart = guardNextRestartTime.get(proc.name) || 0;
                        if (Date.now() > nextRestart + 60_000) {
                            // If it lived over 60s past its backoff threshold, consider it stable
                            guardRestartCounts.delete(proc.name);
                            guardNextRestartTime.delete(proc.name);
                        }
                    }
                }
            }
        } catch (err: any) {
            console.error(`[guard] Error in guard loop: ${err.message}`);
        }
    }, GUARD_INTERVAL_MS);
}
