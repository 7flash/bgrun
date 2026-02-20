import chalk from "chalk";
import { renderProcessTable } from "../table";
import type { ProcessTableRow } from "../table";
import { getAllProcesses } from "../db";
import { announce } from "../logger";
import { isProcessRunning, calculateRuntime, parseEnvString } from "../utils";
import { getProcessPorts, getProcessBatchMemory } from "../platform";
import { measure } from "measure-fn";

function formatMemory(bytes: number): string {
    if (bytes === 0) return '-';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
}

export async function showAll(opts?: { json?: boolean; filter?: string }) {
    const processes = getAllProcesses();

    // Apply filter by env.BGR_GROUP if provided
    const filtered = processes.filter((proc) => {
        if (!opts?.filter) return true;
        const envVars = parseEnvString(proc.env);
        return envVars["BGR_GROUP"] === opts.filter;
    });

    if (opts?.json) {
        // JSON output with filtered env variables
        const jsonData: any[] = [];

        for (const proc of filtered) {
            const isRunning = await isProcessRunning(proc.pid, proc.command);
            const envVars = parseEnvString(proc.env);

            const ports = isRunning ? await getProcessPorts(proc.pid) : [];
            jsonData.push({
                pid: proc.pid,
                name: proc.name,
                ports: ports.length > 0 ? ports : undefined,
                status: isRunning ? "running" : "stopped",
                env: envVars,
            });
        }

        console.log(JSON.stringify(jsonData, null, 2));
        return;
    }

    // Table output
    const tableData: ProcessTableRow[] = [];

    // Batch fetch memory for all PIDs
    const allPids = filtered.map(p => p.pid);
    const memoryMap = await getProcessBatchMemory(allPids);

    for (const proc of filtered) {
        const isRunning = await isProcessRunning(proc.pid, proc.command);
        const runtime = calculateRuntime(proc.timestamp);
        const mem = isRunning ? (memoryMap.get(proc.pid) || 0) : 0;

        const ports = isRunning ? await getProcessPorts(proc.pid) : [];
        tableData.push({
            id: proc.id,
            pid: proc.pid,
            name: proc.name,
            port: ports.length > 0 ? ports.map(p => `:${p}`).join(',') : '-',
            memory: formatMemory(mem),
            command: proc.command,
            workdir: proc.workdir,
            status: isRunning
                ? chalk.green.bold("● Running")
                : chalk.red.bold("○ Stopped"),
            runtime: runtime,
        });
    }

    if (tableData.length === 0) {
        if (opts?.filter) {
            announce(`No processes matched filter BGR_GROUP='${opts.filter}'.`, "No Matches");
        } else {
            announce("No processes found.", "Empty");
        }
        return;
    }

    const tableOutput = renderProcessTable(tableData, {
        padding: 1,
        borderStyle: "rounded",
        showHeaders: true,
    });
    console.log(tableOutput);

    const runningCount = tableData.filter((p) => p.status.includes("Running")).length;
    const stoppedCount = tableData.filter((p) => p.status.includes("Stopped")).length;
    console.log(
        chalk.cyan(
            `Total: ${tableData.length} processes (${chalk.green(`${runningCount} running`)}, ${chalk.red(`${stoppedCount} stopped`)})`
        )
    );
}
