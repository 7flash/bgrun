import type { CommandOptions } from "../types";
import { getProcess, removeProcessByName, retryDatabaseOperation, insertProcess } from "../db";
import { isProcessRunning, terminateProcess, getHomeDir, getShellCommand, killProcessOnPort, findChildPid, getProcessPorts, waitForPortFree } from "../platform";
import { error, announce } from "../logger";
import { validateDirectory, parseEnvString } from "../utils";
import { parseConfigFile } from "../config";
import { $ } from "bun";
import { sleep } from "bun";
import { join } from "path";
import { createMeasure } from "measure-fn";

const homePath = getHomeDir();
const run = createMeasure('run');

export async function handleRun(options: CommandOptions) {
    const { command, directory, env, name, configPath, force, fetch, stdout, stderr } = options;

    const existingProcess = name ? getProcess(name) : null;

    if (existingProcess) {
        const finalDirectory = directory || existingProcess.workdir;
        validateDirectory(finalDirectory);
        $.cwd(finalDirectory);

        if (fetch) {
            if (!require('fs').existsSync(require('path').join(finalDirectory, '.git'))) {
                error(`Cannot --fetch: '${finalDirectory}' is not a Git repository.`);
            }
            await run.measure(`Git fetch "${name}"`, async () => {
                try {
                    await $`git fetch origin`;
                    const localHash = (await $`git rev-parse HEAD`.text()).trim();
                    const remoteHash = (await $`git rev-parse origin/$(git rev-parse --abbrev-ref HEAD)`.text()).trim();

                    if (localHash !== remoteHash) {
                        await $`git pull origin $(git rev-parse --abbrev-ref HEAD)`;
                        announce("📥 Pulled latest changes", "Git Update");
                    }
                } catch (err) {
                    error(`Failed to pull latest changes: ${err}`);
                }
            });
        }

        const isRunning = await isProcessRunning(existingProcess.pid);
        if (isRunning && !force) {
            error(`Process '${name}' is currently running. Use --force to restart.`);
        }

        // Detect ports BEFORE killing so we can clean them up
        let detectedPorts: number[] = [];
        if (isRunning) {
            detectedPorts = await getProcessPorts(existingProcess.pid);
        }

        if (isRunning) {
            await run.measure(`Terminate "${name}" (PID ${existingProcess.pid})`, async () => {
                await terminateProcess(existingProcess.pid);
                announce(`🔥 Terminated existing process '${name}'`, "Process Terminated");
            });
        }

        // Kill anything still on the ports the old process was using
        if (detectedPorts.length > 0) {
            await run.measure(`Port cleanup [${detectedPorts.join(', ')}]`, async () => {
                for (const port of detectedPorts) {
                    await killProcessOnPort(port);
                }
                for (const port of detectedPorts) {
                    const freed = await waitForPortFree(port, 5000);
                    if (!freed) {
                        await killProcessOnPort(port);
                        await waitForPortFree(port, 3000);
                    }
                }
            });
        }

        await retryDatabaseOperation(() =>
            removeProcessByName(name!)
        );
    } else {
        if (!directory || !name || !command) {
            error("'directory', 'name', and 'command' parameters are required for new processes.");
        }
        validateDirectory(directory!);
        $.cwd(directory!);
    }

    const finalCommand = command || existingProcess!.command;
    const finalDirectory = directory || (existingProcess?.workdir!);
    let finalEnv = env || (existingProcess ? parseEnvString(existingProcess.env) : {});

    let finalConfigPath: string | undefined | null;
    if (configPath !== undefined) {
        finalConfigPath = configPath;
    } else if (existingProcess) {
        finalConfigPath = existingProcess.configPath;
    } else {
        finalConfigPath = '.config.toml';
    }

    if (finalConfigPath) {
        const fullConfigPath = join(finalDirectory, finalConfigPath);

        if (await Bun.file(fullConfigPath).exists()) {
            const configEnv = await run.measure(`Parse config "${finalConfigPath}"`, async () => {
                try {
                    return await parseConfigFile(fullConfigPath);
                } catch (err: any) {
                    console.warn(`Warning: Failed to parse config file ${finalConfigPath}: ${err.message}`);
                    return null;
                }
            });
            if (configEnv) {
                finalEnv = { ...finalEnv, ...configEnv };
                console.log(`Loaded config from ${finalConfigPath}`);
            }
        } else {
            console.log(`Config file '${finalConfigPath}' not found, continuing without it.`);
        }
    }

    const stdoutPath = stdout || existingProcess?.stdout_path || join(homePath, ".bgr", `${name}-out.txt`);
    Bun.write(stdoutPath, '');
    const stderrPath = stderr || existingProcess?.stderr_path || join(homePath, ".bgr", `${name}-err.txt`);
    Bun.write(stderrPath, '');

    const actualPid = await run.measure(`Spawn "${name}" → ${finalCommand}`, async () => {
        const newProcess = Bun.spawn(getShellCommand(finalCommand!), {
            env: { ...Bun.env, ...finalEnv },
            cwd: finalDirectory,
            stdout: Bun.file(stdoutPath),
            stderr: Bun.file(stderrPath),
        });

        newProcess.unref();
        // Give shell a moment to spawn child, then find PID before shell exits
        await sleep(100);
        // Find the actual child PID (shell wrapper exits immediately after spawning)
        const pid = await findChildPid(newProcess.pid);
        // Wait more for subprocess to initialize
        await sleep(400);
        return pid;
    }) ?? 0;

    await retryDatabaseOperation(() =>
        insertProcess({
            pid: actualPid,
            workdir: finalDirectory,
            command: finalCommand!,
            name: name!,
            env: Object.entries(finalEnv).map(([k, v]) => `${k}=${v}`).join(","),
            configPath: finalConfigPath || '',
            stdout_path: stdoutPath,
            stderr_path: stderrPath,
        })
    );

    announce(
        `${existingProcess ? '🔄 Restarted' : '🚀 Launched'} process "${name}" with PID ${actualPid}`,
        "Process Started"
    );
}
