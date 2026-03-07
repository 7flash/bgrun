/**
 * BGR Standalone Process Guard
 * 
 * Runs as an independent process that monitors ALL guarded processes
 * (BGR_KEEP_ALIVE=true) and the dashboard itself. If the dashboard
 * crashes, the guard restarts it. If any guarded process dies, the 
 * guard restarts it.
 * 
 * This is the "outer shell" — it cannot be killed by a dashboard crash.
 * 
 * Usage:
 *   bgrun --guard              # Start guard as a managed bgrun process
 *   bgrun --_guard-loop        # (Internal) Actually run the guard loop
 *   bgrun --_guard-loop 30     # Check every 30 seconds
 */

import { getAllProcesses, getProcess } from './db';
import { isProcessRunning, getProcessPorts, findChildPid } from './platform';
import { handleRun } from './commands/run';
import { parseEnvString } from './utils';

const DEFAULT_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000; // 5 minutes max
const CRASH_THRESHOLD = 5; // Start backoff after this many restarts
const STABILITY_WINDOW_MS = 120_000; // 2 minutes stable = reset counter

interface GuardState {
    restartCounts: Map<string, number>;
    nextRestartTime: Map<string, number>;
    lastSeenAlive: Map<string, number>;
}

const state: GuardState = {
    restartCounts: new Map(),
    nextRestartTime: new Map(),
    lastSeenAlive: new Map(),
};

async function restartProcess(name: string): Promise<boolean> {
    try {
        await handleRun({
            action: 'run',
            name,
            force: true,
            remoteName: '',
        });
        return true;
    } catch (err: any) {
        console.error(`[guard] ✗ Failed to restart "${name}": ${err.message}`);
        return false;
    }
}

function getBackoffMs(restartCount: number): number {
    if (restartCount <= CRASH_THRESHOLD) return 0;
    const exponent = restartCount - CRASH_THRESHOLD;
    return Math.min(30_000 * Math.pow(2, exponent - 1), MAX_BACKOFF_MS);
}

async function guardCycle(): Promise<void> {
    try {
        const processes = getAllProcesses();
        if (processes.length === 0) return;

        const now = Date.now();
        let checked = 0;
        let restarted = 0;
        let skipped = 0;

        for (const proc of processes) {
            // Skip the guard process itself
            if (proc.name === 'bgr-guard') continue;

            const env = proc.env ? parseEnvString(proc.env) : {};
            const isGuarded = env.BGR_KEEP_ALIVE === 'true';
            const isDashboard = proc.name === 'bgr-dashboard';

            // Guard both: explicitly guarded processes AND the dashboard
            if (!isGuarded && !isDashboard) continue;

            checked++;

            try {
                const alive = await isProcessRunning(proc.pid, proc.command);

                if (!alive && proc.pid > 0) {
                    // Check backoff
                    const nextRestart = state.nextRestartTime.get(proc.name) || 0;
                    if (now < nextRestart) {
                        const waitSecs = Math.round((nextRestart - now) / 1000);
                        skipped++;
                        continue;
                    }

                    console.log(`[guard] ⚠ "${proc.name}" (PID ${proc.pid}) is dead — restarting...`);

                    const success = await restartProcess(proc.name);
                    if (success) {
                        const count = (state.restartCounts.get(proc.name) || 0) + 1;
                        state.restartCounts.set(proc.name, count);
                        state.lastSeenAlive.delete(proc.name);

                        const backoff = getBackoffMs(count);
                        if (backoff > 0) {
                            state.nextRestartTime.set(proc.name, now + backoff);
                            console.log(`[guard] ✓ Restarted "${proc.name}" (#${count}). Crash loop: next check in ${Math.round(backoff / 1000)}s`);
                        } else {
                            console.log(`[guard] ✓ Restarted "${proc.name}" (#${count})`);
                        }
                        restarted++;
                    }
                } else if (alive) {
                    // Track stability — if alive for STABILITY_WINDOW, reset counters
                    const count = state.restartCounts.get(proc.name) || 0;
                    if (count > 0) {
                        const lastSeen = state.lastSeenAlive.get(proc.name);
                        if (!lastSeen) {
                            state.lastSeenAlive.set(proc.name, now);
                        } else if (now - lastSeen > STABILITY_WINDOW_MS) {
                            state.restartCounts.delete(proc.name);
                            state.nextRestartTime.delete(proc.name);
                            state.lastSeenAlive.delete(proc.name);
                            console.log(`[guard] ✓ "${proc.name}" stable for ${Math.round(STABILITY_WINDOW_MS / 1000)}s — reset counters`);
                        }
                    }
                }
            } catch (err: any) {
                console.error(`[guard] Error checking "${proc.name}": ${err.message}`);
            }
        }

        if (restarted > 0) {
            console.log(`[guard] Cycle: ${checked} checked, ${restarted} restarted, ${skipped} in backoff`);
        }
    } catch (err: any) {
        console.error(`[guard] Error in guard cycle: ${err.message}`);
    }
}

export async function startGuardLoop(intervalMs: number = DEFAULT_INTERVAL_MS) {
    const interval = intervalMs || DEFAULT_INTERVAL_MS;

    console.log(`[guard] ═══════════════════════════════════════════`);
    console.log(`[guard] 🛡️  BGR Standalone Guard started`);
    console.log(`[guard]    Check interval: ${interval / 1000}s`);
    console.log(`[guard]    Crash backoff threshold: ${CRASH_THRESHOLD} restarts`);
    console.log(`[guard]    Stability window: ${STABILITY_WINDOW_MS / 1000}s`);
    console.log(`[guard]    Monitoring: BGR_KEEP_ALIVE=true + bgr-dashboard`);
    console.log(`[guard]    Started: ${new Date().toLocaleString()}`);
    console.log(`[guard] ═══════════════════════════════════════════`);

    // Run initial check immediately
    await guardCycle();

    // Then run on interval
    setInterval(guardCycle, interval);
}
