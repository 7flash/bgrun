import type { CommandOptions } from "../types";
import type { Process } from "../db";
import { getProcess } from "../db";
import { isProcessRunning } from "../platform";
import { error, announce } from "../logger";
import { tailFile } from "../utils";
import { handleRun } from "./run";
import * as fs from "fs";
import path from "path";
import chalk, { type ChalkInstance } from "chalk";

export async function handleWatch(options: CommandOptions, logOptions: { showLogs: boolean; logType: 'stdout' | 'stderr' | 'both', lines?: number }) {
    let currentProcess: Process | null = null;
    let isRestarting = false;
    let debounceTimeout: Timer | null = null;
    let tailStops: (() => void)[] = [];
    let lastRestartPath: string | null = null; // Track if restart was due to file change

    const dumpLogsIfDead = async (proc: Process, reason: string) => {
        const isDead = !(await isProcessRunning(proc.pid, proc.command));
        if (!isDead) return false;

        console.log(chalk.yellow(`💀 Process '${options.name}' died immediately after ${reason}—dumping logs:`));

        const readAndDump = (path: string, color: ChalkInstance, label: string) => {
            try {
                if (fs.existsSync(path)) {
                    const content = fs.readFileSync(path, 'utf8').trim();
                    if (content) {
                        console.log(`${color.bold(label)}:\n${color(content)}\n`);
                    } else {
                        console.log(`${color(label)}: (empty)`);
                    }
                }
            } catch (err) {
                console.warn(chalk.gray(`Could not read ${label} log: ${err}`));
            }
        };

        if (logOptions.logType === 'both' || logOptions.logType === 'stdout') {
            readAndDump(proc.stdout_path, chalk.white, '📄 Stdout');
        }
        if (logOptions.logType === 'both' || logOptions.logType === 'stderr') {
            readAndDump(proc.stderr_path, chalk.red, '📄 Stderr');
        }

        return true;
    };

    const waitForLogReady = (logPath: string, timeoutMs = 5000): Promise<void> => {
        return new Promise((resolve, reject) => {
            const checkReady = (): boolean => {
                try {
                    if (fs.existsSync(logPath)) {
                        const stat = fs.statSync(logPath);
                        if (stat.size > 0) {
                            return true;
                        }
                    }
                } catch {
                    // Ignore errors during check
                }
                return false;
            };

            if (checkReady()) {
                resolve();
                return;
            }

            const dir = path.dirname(logPath); // path module needs import. 'path' var name conflict?
            // Need import path from 'path'
            const filename = path.basename(logPath);
            // ERROR: 'path' refers to module or var?
            // I need to import { dirname, basename } from "path";

            const watcher = fs.watch(dir, (eventType, changedFilename) => {
                if (changedFilename === filename && eventType === 'change') {
                    if (checkReady()) {
                        watcher.close();
                        resolve();
                    }
                }
            });

            setTimeout(() => {
                watcher.close();
                reject(new Error(`Log file ${logPath} did not become ready within ${timeoutMs}ms`));
            }, timeoutMs);
        });
    };

    const startTails = async (): Promise<(() => void)[]> => {
        const stops: (() => void)[] = [];

        if (!logOptions.showLogs || !currentProcess) return stops;

        console.log(chalk.gray("\n" + '─'.repeat(50) + "\n"));

        if (logOptions.logType === 'both' || logOptions.logType === 'stdout') {
            console.log(chalk.green.bold(`📄 Tailing stdout for ${options.name}:`));
            console.log(chalk.gray('═'.repeat(50)));
            try {
                await waitForLogReady(currentProcess.stdout_path);
            } catch (err: any) {
                console.warn(chalk.yellow(`⚠️  Stdout log not ready yet for ${options.name}—starting tail anyway: ${err.message}`));
            }
            const stop = tailFile(currentProcess.stdout_path, '', chalk.white, logOptions.lines);
            stops.push(stop);
        }

        if (logOptions.logType === 'both' || logOptions.logType === 'stderr') {
            console.log(chalk.red.bold(`📄 Tailing stderr for ${options.name}:`));
            console.log(chalk.gray('═'.repeat(50)));
            try {
                await waitForLogReady(currentProcess.stderr_path);
            } catch (err: any) {
                console.warn(chalk.yellow(`⚠️  Stderr log not ready yet for ${options.name}—starting tail anyway: ${err.message}`));
            }
            const stop = tailFile(currentProcess.stderr_path, '', chalk.red, logOptions.lines);
            stops.push(stop);
        }

        return stops;
    };

    const restartProcess = async (path?: string) => {
        if (isRestarting) return;
        isRestarting = true;
        const restartReason = path ? `restart (change in ${path})` : 'initial start';
        lastRestartPath = path || null;

        tailStops.forEach(stop => stop());
        tailStops = [];

        console.clear();
        announce(`🔄 Restarting process '${options.name}'... [${restartReason}]`, "Watch Mode");

        try {
            await handleRun({ ...options, force: true });
            currentProcess = getProcess(options.name!); // Need to ensure name is string

            if (!currentProcess) {
                error(`Failed to find process '${options.name}' after restart.`);
                return;
            }

            // Quick post-mortem if it died on startup
            const died = await dumpLogsIfDead(currentProcess, restartReason);
            if (died) {
                if (lastRestartPath) {
                    console.log(chalk.yellow(`⚠️  Compile error on change—pausing restarts until manual fix.`));
                    return; // Avoid loop on bad code
                } else {
                    error(`Failed to start process '${options.name}'. Aborting watch mode.`);
                    return;
                }
            }

            tailStops = await startTails();
        } catch (err) {
            error(`Error during restart: ${err}`);
        } finally {
            isRestarting = false;
            if (currentProcess) {
                console.log(chalk.cyan(`\n👀 Watching for file changes in: ${currentProcess.workdir}`));
            }
        }
    };

    // Initial start
    console.clear();
    announce(`🚀 Starting initial process '${options.name}' in watch mode...`, "Watch Mode");
    await handleRun(options);
    currentProcess = getProcess(options.name!);

    if (!currentProcess) {
        error(`Could not start or find process '${options.name}'. Aborting watch mode.`);
        return;
    }

    // Quick post-mortem if initial died
    const initialDied = await dumpLogsIfDead(currentProcess, 'initial start');
    if (initialDied) {
        error(`Failed to start process '${options.name}'. Aborting watch mode.`);
        return;
    }

    tailStops = await startTails();

    const workdir = currentProcess.workdir;
    console.log(chalk.cyan(`\n👀 Watching for file changes in: ${workdir}`));

    const watcher = fs.watch(workdir, { recursive: true }, (eventType, filename) => {
        if (filename == null) return;
        const fullPath = path.join(workdir, filename as string);
        if (fullPath.includes(".git") || fullPath.includes("node_modules")) return;
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => restartProcess(fullPath), 500);
    });

    const cleanup = async () => {
        console.log(chalk.magenta('\nSIGINT received...'));
        watcher.close();
        tailStops.forEach(stop => stop());
        if (debounceTimeout) clearTimeout(debounceTimeout);

        const procToKill = getProcess(options.name!);
        if (procToKill) {
            const isRunning = await isProcessRunning(procToKill.pid, procToKill.command);
            if (isRunning) {
                // @note avoid "await terminateProcess(procToKill.pid)" because we can re-attach --watch mode to running process
                console.log(`process ${procToKill.name} (PID: ${procToKill.pid}) still running`);
            }
        }
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}