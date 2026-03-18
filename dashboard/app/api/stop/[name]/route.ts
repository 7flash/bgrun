/**
 * POST /api/stop/:name — Stop a running process
 * 
 * Kills the registered PID, then kills anything remaining on the port.
 * Sets PID to 0 to prevent reconciliation from hijacking unrelated processes.
 */
import { getProcess, updateProcessPid, addHistoryEntry } from '../../../../../src/db';
import { isProcessRunning, terminateProcess, getProcessPorts, killProcessOnPort } from '../../../../../src/platform';
import { measure } from 'measure-fn';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const running = await isProcessRunning(proc.pid);
    if (!running) {
        // Already dead — mark PID as 0 to prevent reconciliation
        updateProcessPid(name, 0);
        return Response.json({ success: true, already_stopped: true });
    }

    // Detect ports BEFORE killing so we can clean them up
    const ports = await getProcessPorts(proc.pid);

    await measure(`Stop "${name}" (PID ${proc.pid})`, () => terminateProcess(proc.pid));

    // Also kill anything still on the ports
    for (const port of ports) {
        await killProcessOnPort(port);
    }

    // Mark PID as 0 — prevents reconcileProcessPids from re-attaching
    // a random matching process as this one
    updateProcessPid(name, 0);

    // Record history
    addHistoryEntry(name, 'stop', proc.pid);

    return Response.json({ success: true });
}
