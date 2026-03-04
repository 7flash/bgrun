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
import { getAllProcesses, getProcess } from './db';
import { isProcessRunning } from './platform';
import { handleRun } from './commands/run';

const GUARD_INTERVAL_MS = 30_000; // Check every 30 seconds
const GUARD_SKIP_NAMES = new Set(['bgr-dashboard']); // Don't try to restart ourselves

export async function startServer() {
    // Dynamic import to avoid melina's side-effect console.log at bundle load time
    const { start } = await import('melina');
    const appDir = path.join(import.meta.dir, '../dashboard/app');

    // Only pass port when BUN_PORT is explicitly set.
    // When omitted, Melina defaults to 3000 with auto-fallback to next available port.
    const explicitPort = process.env.BUN_PORT ? parseInt(process.env.BUN_PORT, 10) : undefined;
    await start({
        appDir,
        defaultTitle: 'bgrun Dashboard - Process Manager',
        globalCss: path.join(appDir, 'globals.css'),
        ...(explicitPort !== undefined && { port: explicitPort }),
    });

    // Start the built-in process guard
    startGuard();
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
                const env = proc.env ? (typeof proc.env === 'string' ? (() => { try { return JSON.parse(proc.env); } catch { return {}; } })() : proc.env) : {};
                if (env.BGR_KEEP_ALIVE !== 'true') continue;

                const alive = await isProcessRunning(proc.pid, proc.command);
                if (!alive) {
                    console.log(`[guard] ⚠ Guarded process "${proc.name}" (PID ${proc.pid}) is dead, restarting...`);
                    try {
                        await handleRun({
                            action: 'run',
                            name: proc.name,
                            force: true,
                            remoteName: '',
                        });
                        console.log(`[guard] ✓ Restarted "${proc.name}"`);
                    } catch (err: any) {
                        console.error(`[guard] ✗ Failed to restart "${proc.name}": ${err.message}`);
                    }
                }
            }
        } catch (err: any) {
            console.error(`[guard] Error in guard loop: ${err.message}`);
        }
    }, GUARD_INTERVAL_MS);
}
