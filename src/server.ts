/**
 * BGR Dashboard Server + Built-in Process Guard
 * 
 * Uses Melina.js to serve the dashboard app with file-based routing.
 * All API endpoints and page rendering are handled by the dashboard/app/ directory.
 * 
 * Port selection is handled entirely by Melina:
 *   - If BUN_PORT env var is set → uses that (explicit, will fail if busy)
 *   - Otherwise → defaults to 3000, falls back to next available if busy
 */
import path from 'path';
import { getAllProcesses } from './db';
import { isProcessRunning, killProcessOnPort, waitForPortFree, isPortFree } from './platform';
export const guardRestartCounts: Map<string, number> = new Map();
export const guardEvents: { time: number; name: string; action: string; success: boolean }[] = [];

/**
 * Try to reclaim the requested dashboard port before Melina starts.
 *
 * On Windows, we must wait for termination to complete and verify the port is
 * truly free. Fire-and-forget taskkill can leave the old dashboard child alive,
 * causing two listeners on the same port and hung HTTP requests.
 */
async function cleanupPort(port: number): Promise<number> {
    if (process.platform !== 'win32') return port;

    try {
        const occupiedBefore = !(await isPortFree(port));
        if (!occupiedBefore) return port;

        console.log(`[server] Reclaiming port ${port} before dashboard start`);
        await killProcessOnPort(port);

        const freed = await waitForPortFree(port, 8000);
        if (freed) return port;

        // One more sweep in case a child/grandchild survived the first kill.
        console.warn(`[server] Port ${port} still busy after first cleanup; retrying`);
        await killProcessOnPort(port);
        const freedAfterRetry = await waitForPortFree(port, 5000);
        if (freedAfterRetry) return port;

        // At this point something else still owns the port (often elevated or a
        // zombie kernel socket). Fall back so the dashboard still comes up.
        const fallback = port + 1;
        console.warn(`[server] ⚠ Could not reclaim port ${port}; falling back to port ${fallback}`);
        return fallback;
    } catch {
        return port; /* best-effort cleanup */
    }
}

let _originalPort = 3000;
let _currentPort = 3000;

export async function startServer() {
    // Dynamic import to avoid melina's side-effect console.log at bundle load time
    const { start } = await import('melina');
    const appDir = path.join(import.meta.dir, '../dashboard/app');

    // Only treat BUN_PORT as explicit when it is actually set to a valid number.
    // Otherwise Melina defaults to 3000 with auto-fallback to the next available port.
    const rawRequestedPort = process.env.BUN_PORT?.trim();
    const explicitPort = rawRequestedPort ? parseInt(rawRequestedPort, 10) : null;
    const hasExplicitPort = explicitPort !== null && !isNaN(explicitPort) && explicitPort > 0;
    const requestedPort = hasExplicitPort ? explicitPort : 3000;
    _originalPort = requestedPort;

    // Only reclaim ports for explicitly requested dashboard ports.
    const resolvedPort = hasExplicitPort ? await cleanupPort(requestedPort) : requestedPort;
    _currentPort = resolvedPort;

    // Pass port explicitly if user requested one OR if we had to fallback
    const needsExplicitPort = hasExplicitPort || resolvedPort !== requestedPort;
    await start({
        appDir,
        defaultTitle: 'bgrun Dashboard - Process Manager',
        globalCss: path.join(appDir, 'globals.css'),
        ...(needsExplicitPort && { port: resolvedPort }),
    });

    // Start log rotation (prevents unbounded log file growth)
    const { startLogRotation } = await import('./log-rotation');
    startLogRotation(() => getAllProcesses());

    // Start sticky port checker - periodically try original port if we're on a fallback
    if (resolvedPort !== requestedPort) {
        startStickyPortChecker();
    }
}

if (import.meta.main) {
    await startServer();
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

