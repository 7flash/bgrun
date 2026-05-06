
import { error, announce } from "../logger";
import { getProcess, updateProcessPid } from "../db";
import { isProcessRunning, calculateRuntime, parseEnvString, isInternalProcessName } from "../utils";
import { reconcileProcessPids, resolvePidWithPorts } from "../platform";
import chalk from "chalk";

export async function showDetails(name: string) {
    const proc = getProcess(name);
    if (!proc) {
        error(`No process found named '${name}'`);
        return;
    }
    if (isInternalProcessName(proc.name)) {
        error(`'${name}' is an internal bgrun process.`);
        return;
    }

    let isRunning = await isProcessRunning(proc.pid, proc.command);

    // Reconcile stale PID: cmd.exe wrapper may have exited while bun.exe child lives
    if (!isRunning && proc.pid > 0) {
        const reconciled = await reconcileProcessPids(
            [{ name: proc.name, pid: proc.pid, command: proc.command, workdir: proc.workdir }],
            new Set([proc.pid]),
        );
        const newPid = reconciled.get(proc.name);
        if (newPid) {
            updateProcessPid(proc.name, newPid);
            (proc as any).pid = newPid;
            isRunning = true;
        }
    }
    const runtime = calculateRuntime(proc.timestamp);
    const envVars = parseEnvString(proc.env);

    // Detect actual ports via OS, resolving live wrapper PID when needed
    let ports: number[] = [];
    if (isRunning) {
        const resolved = await resolvePidWithPorts(proc.pid);
        ports = resolved.ports;
        if (resolved.pid !== proc.pid) {
            updateProcessPid(proc.name, resolved.pid);
            (proc as any).pid = resolved.pid;
        }
    }

    const portDisplay = ports.length > 0
        ? ports.map(p => chalk.hex('#FF6B6B')(`:${p}`)).join(', ')
        : null;

    const details = `
${chalk.bold('Process Details:')}
${chalk.gray('═'.repeat(50))}
${chalk.cyan.bold('Name:')} ${proc.name}
${chalk.yellow.bold('PID:')} ${proc.pid}${portDisplay ? `\n${chalk.hex('#FF6B6B').bold('Port:')} ${portDisplay}` : ''}
${chalk.bold('Status:')} ${isRunning ? chalk.green.bold("● Running") : chalk.red.bold("○ Stopped")}
${chalk.magenta.bold('Runtime:')} ${runtime}
${chalk.blue.bold('Working Directory:')} ${proc.workdir}
${chalk.white.bold('Command:')} ${proc.command}
${chalk.gray.bold('Config Path:')} ${proc.configPath}
${chalk.green.bold('Stdout Path:')} ${proc.stdout_path}
${chalk.red.bold('Stderr Path:')} ${proc.stderr_path}

${chalk.bold('🔧 Environment Variables:')}
${chalk.gray('═'.repeat(50))}
${Object.entries(envVars)
            .map(([key, value]) => `${chalk.cyan.bold(key)} = ${chalk.yellow(value)}`)
            .join('\n')}
`;
    announce(details, `Process Details: ${name}`);
}
