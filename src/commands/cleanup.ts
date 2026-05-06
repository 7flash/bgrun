
import { getProcess, removeProcessByName, removeProcess, getAllProcesses, removeAllProcesses, updateProcessPid } from "../db";
import { isProcessRunning, terminateProcess, getProcessPorts, killProcessOnPort, waitForPortFree, isPortFree } from "../platform";
import { parseEnvString, getDeclaredPort, acquireProcessOperationLock, getWatchedProcessName, isInternalProcessName } from "../utils";
import { announce, error } from "../logger";
import * as fs from "fs";
import { stopProcessWatcher } from "../watcher";

export async function handleDelete(name: string) {
    const process = getProcess(name);

    if (!process) {
        error(`No process found named '${name}'`);
        return;
    }

    const isRunning = await isProcessRunning(process.pid);
    if (isRunning) {
        await terminateProcess(process.pid);
    }

    if (!isInternalProcessName(name)) {
        await stopProcessWatcher(name);
    }

    if (fs.existsSync(process.stdout_path)) {
        try { fs.unlinkSync(process.stdout_path); } catch { }
    }
    if (fs.existsSync(process.stderr_path)) {
        try { fs.unlinkSync(process.stderr_path); } catch { }
    }

    removeProcessByName(name);
    announce(`Process '${name}' has been ${isRunning ? 'stopped and ' : ''}deleted`, "Process Deleted");
}

export async function handleClean() {
    const processes = getAllProcesses();
    let cleanedCount = 0;
    let deletedLogs = 0;

    for (const proc of processes) {
        const running = await isProcessRunning(proc.pid);
        if (!running) {
            const watched = getWatchedProcessName(proc.name);
            if (watched) {
                removeProcess(proc.pid);
                cleanedCount++;
                continue;
            }
            removeProcess(proc.pid);
            cleanedCount++;

            if (fs.existsSync(proc.stdout_path)) {
                try { fs.unlinkSync(proc.stdout_path); deletedLogs++; } catch { }
            }
            if (fs.existsSync(proc.stderr_path)) {
                try { fs.unlinkSync(proc.stderr_path); deletedLogs++; } catch { }
            }
        }
    }

    if (cleanedCount === 0) {
        announce("No stopped processes found to clean.", "Clean Complete");
    } else {
        announce(
            `Cleaned ${cleanedCount} stopped ${cleanedCount === 1 ? 'process' : 'processes'} and removed ${deletedLogs} log ${deletedLogs === 1 ? 'file' : 'files'}.`,
            "Clean Complete"
        );
    }
}

export async function handleStop(name: string) {
    const proc = getProcess(name);

    if (!proc) {
        error(`No process found named '${name}'`);
        return;
    }

    const releaseOperationLock = acquireProcessOperationLock(name);
    try {
        const isRunning = await isProcessRunning(proc.pid);
        if (!isRunning) {
            announce(`Process '${name}' is already stopped.`, "Process Stop");
            return;
        }

        // Detect ports the process is using BEFORE killing it
        const ports = await getProcessPorts(proc.pid);

        await terminateProcess(proc.pid);

        // Also kill by detected ports as safety net
        for (const port of ports) {
            await killProcessOnPort(port);
        }

        // Also clean up the declared port if one exists.
        // This is critical when the stored PID is dead (e.g., cmd.exe wrapper died)
        // but the orphaned child (bun.exe) is still holding the port.
        const procEnv = proc.env ? parseEnvString(proc.env) : {};
        const declaredPort = getDeclaredPort(procEnv, proc.command);
        if (declaredPort && !ports.includes(declaredPort)) {
            const portFree = await isPortFree(declaredPort);
            if (!portFree) {
                console.log(`[stop] Declared port ${declaredPort} is busy (orphaned process), cleaning up...`);
                await killProcessOnPort(declaredPort);
                await waitForPortFree(declaredPort, 3000);
            }
        }

        // Mark PID as 0 — prevents reconcileProcessPids from re-attaching
        // a random matching process as this one
        updateProcessPid(name, 0);

        announce(`Process '${name}' has been stopped (kept in registry).`, "Process Stopped");
    } finally {
        releaseOperationLock();
    }
}

export async function handleDeleteAll() {
    const processes = getAllProcesses();
    if (processes.length === 0) {
        announce("There are no processes to delete.", "Delete All");
        return;
    }

    let killedCount = 0;
    let portsFreed = 0;

    for (const proc of processes) {
        if (!isInternalProcessName(proc.name)) {
            await stopProcessWatcher(proc.name);
        }
        const running = await isProcessRunning(proc.pid);

        if (running) {
            // Detect ports BEFORE killing so we can clean them up
            const ports = await getProcessPorts(proc.pid);

            // Force-kill the process tree
            await terminateProcess(proc.pid, true);
            killedCount++;

            // Kill anything still holding the ports
            for (const port of ports) {
                await killProcessOnPort(port);
                const freed = await waitForPortFree(port, 3000);
                if (!freed) {
                    await killProcessOnPort(port);
                    await waitForPortFree(port, 2000);
                }
                portsFreed++;
            }
        }

        // Also clean up the declared port if one exists (handles orphaned processes)
        const procEnv = proc.env ? parseEnvString(proc.env) : {};
        const declaredPort = getDeclaredPort(procEnv, proc.command);
        if (declaredPort) {
            const portFree = await isPortFree(declaredPort);
            if (!portFree) {
                console.log(`[nuke] Declared port ${declaredPort} is busy, cleaning up...`);
                await killProcessOnPort(declaredPort);
                const freed = await waitForPortFree(declaredPort, 3000);
                if (freed) portsFreed++;
            }
        }

        // Clean up log files
        if (fs.existsSync(proc.stdout_path)) {
            try { fs.unlinkSync(proc.stdout_path); } catch { }
        }
        if (fs.existsSync(proc.stderr_path)) {
            try { fs.unlinkSync(proc.stderr_path); } catch { }
        }
    }

    removeAllProcesses();

    const parts = [`${processes.length} ${processes.length === 1 ? 'process' : 'processes'} deleted`];
    if (killedCount > 0) parts.push(`${killedCount} force-killed`);
    if (portsFreed > 0) parts.push(`${portsFreed} ${portsFreed === 1 ? 'port' : 'ports'} freed`);

    announce(parts.join(', ') + '.', "Nuke Complete");
}
