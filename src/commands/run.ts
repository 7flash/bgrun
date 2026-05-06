import type { CommandOptions } from "../types";
import {
  getProcess,
  removeProcessByName,
  retryDatabaseOperation,
  insertProcess,
  updateProcessPid,
} from "../db";
import {
  isProcessRunning,
  terminateProcess,
  getHomeDir,
  getShellCommand,
  killProcessOnPort,
  findChildPid,
  getProcessPorts,
  waitForPortFree,
  psExec,
  isPortFree,
  reconcileProcessPids,
} from "../platform";
import { error, announce } from "../logger";
import {
  validateDirectory,
  parseEnvString,
  buildManagedProcessEnv,
  getDeclaredPort,
  acquireProcessOperationLock,
  isInternalProcessName,
  stringifyEnvString,
} from "../utils";
import { parseConfigFile } from "../config";
import { $ } from "bun";
import { sleep } from "bun";
import { join } from "path";
import { createMeasure } from "measure-fn";
import { syncProcessWatcher } from "../watcher";

const homePath = getHomeDir();
const run = createMeasure("run");
const INTERNAL_BUNX_PREFIX = "bunx bgrun";

export function resolveInternalBgrunCommand(command: string): string {
  const trimmed = command.trim();
  if (
    !trimmed.startsWith("bgrun --_") &&
    !trimmed.startsWith(`${INTERNAL_BUNX_PREFIX} --_`)
  ) {
    return command;
  }

  if (trimmed.startsWith(`${INTERNAL_BUNX_PREFIX} --_`)) {
    return trimmed;
  }

  return `${INTERNAL_BUNX_PREFIX}${trimmed.slice("bgrun".length)}`;
}

export async function handleRun(options: CommandOptions) {
  const {
    command,
    directory,
    env,
    name,
    configPath,
    force,
    fetch,
    stdout,
    stderr,
  } = options;
  const releaseOperationLock = name
    ? acquireProcessOperationLock(name)
    : () => {};

  try {
    const existingProcess = name ? getProcess(name) : null;

    // Auto-start unmet dependencies before starting this process
    if (name && existingProcess) {
      const { getUnmetDeps } = await import("../deps");
      const unmet = await getUnmetDeps(name);
      if (unmet.length > 0) {
        await run.measure(
          `Start ${unmet.length} dependencies for "${name}"`,
          async () => {
            for (const depName of unmet) {
              const depProc = getProcess(depName);
              if (depProc) {
                announce(
                  `📦 Starting dependency "${depName}" for "${name}"`,
                  "Dependency",
                );
                await handleRun({
                  action: "run",
                  name: depName,
                  force: true,
                  remoteName: "",
                });
              }
            }
          },
        );
      }
    }

    if (existingProcess) {
      const finalDirectory = directory || existingProcess.workdir;
      validateDirectory(finalDirectory);
      $.cwd(finalDirectory);

      if (fetch) {
        if (
          !require("fs").existsSync(
            require("path").join(finalDirectory, ".git"),
          )
        ) {
          error(`Cannot --fetch: '${finalDirectory}' is not a Git repository.`);
        }
        await run.measure(`Git fetch "${name}"`, async () => {
          try {
            await $`git fetch origin`;
            const localHash = (await $`git rev-parse HEAD`.text()).trim();
            const remoteHash = (
              await $`git rev-parse origin/$(git rev-parse --abbrev-ref HEAD)`.text()
            ).trim();

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
        error(
          `Process '${name}' is currently running. Use --force to restart.`,
        );
      }

      // PID Reconciliation: If stored PID is dead, try to find a matching live process
      // This handles the case where cmd.exe wrapper died but bun.exe child is still running
      // Skip reconciliation on --restart (force) to avoid attaching to wrong process
      let actualPid = existingProcess.pid;
      if (!isRunning && !force) {
        const reconciled = await reconcileProcessPids(
          [
            {
              name: name!,
              pid: existingProcess.pid,
              command: existingProcess.command,
              workdir: existingProcess.workdir,
            },
          ],
          new Set([existingProcess.pid]),
        );
        const newPid = reconciled.get(name!);
        if (newPid) {
          console.log(
            `[run] Reconciled dead PID ${existingProcess.pid} to live PID ${newPid}`,
          );
          actualPid = newPid;
          updateProcessPid(name!, newPid);
        }
      }

      // Detect ports BEFORE killing so we can clean them up
      // Use actualPid which may have been reconciled from a dead wrapper to a live child
      let detectedPorts: number[] = [];
      const actuallyRunning = await isProcessRunning(actualPid);
      if (actuallyRunning) {
        detectedPorts = await getProcessPorts(actualPid);
      }

      if (actuallyRunning) {
        await run.measure(
          `Terminate "${name}" (PID ${actualPid})`,
          async () => {
            await terminateProcess(actualPid);
            announce(
              `🔥 Terminated existing process '${name}'`,
              "Process Terminated",
            );
          },
        );
      }

      // Kill anything still on the ports the old process was using
      if (detectedPorts.length > 0) {
        await run.measure(
          `Port cleanup [${detectedPorts.join(", ")}]`,
          async () => {
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
          },
        );
      }

      // Also clean up the declared port if one exists.
      // This is critical when the stored PID is dead (e.g., cmd.exe wrapper died)
      // but the orphaned child (bun.exe) is still holding the port.
      // getProcessPorts() returns [] for dead PIDs, so we need to check the declared port separately.
      const existingEnv = existingProcess.env
        ? parseEnvString(existingProcess.env)
        : {};
      const declaredPort = getDeclaredPort(
        existingEnv,
        existingProcess.command,
      );
      if (declaredPort && !detectedPorts.includes(declaredPort)) {
        await run.measure(
          `Declared port cleanup [${declaredPort}]`,
          async () => {
            const portFree = await isPortFree(declaredPort);
            if (!portFree) {
              console.log(
                `[run] Declared port ${declaredPort} is busy (orphaned process), cleaning up...`,
              );
              await killProcessOnPort(declaredPort);
              const freed = await waitForPortFree(declaredPort, 5000);
              if (!freed) {
                console.warn(
                  `[run] Port ${declaredPort} still busy after cleanup, retrying...`,
                );
                await killProcessOnPort(declaredPort);
                await waitForPortFree(declaredPort, 3000);
              }
            }
          },
        );
      }

      // Zombie sweep: kill any remaining bun processes matching this command
      // This catches orphaned children that survived taskkill when the parent shell exited
      // IMPORTANT: Exclude the current bgrun process and dashboard to avoid self-kill
      const cmdToMatch = existingProcess.command;
      if (cmdToMatch) {
        await run.measure("Zombie sweep", async () => {
          try {
            const cmdKeyword = cmdToMatch.split(" ")[1] || cmdToMatch;
            // Skip sweep if keyword is too generic (would match unrelated processes)
            const GENERIC_KEYWORDS = [
              "dev",
              "run",
              "start",
              "serve",
              "build",
              "test",
            ];
            if (GENERIC_KEYWORDS.includes(cmdKeyword.toLowerCase())) {
              return; // Too dangerous — skip zombie sweep for generic commands
            }
            const currentPid = process.pid;
            // Use -like with wildcards instead of -match to avoid regex special chars breaking the query
            const result = await psExec(
              `Get-CimInstance Win32_Process -Filter "Name='bun.exe'" | Where-Object { $_.CommandLine -like '*${cmdKeyword.replace(/'/g, "''").replace(/([&[\](){}^$|\\*?+])/g, "$&")}*' -and $_.ProcessId -ne ${currentPid} } | Select-Object -ExpandProperty ProcessId`,
              3000,
            );
            const zombiePids = result
              .split("\n")
              .map((l: string) => parseInt(l.trim()))
              .filter((n: number) => !isNaN(n) && n > 0 && n !== currentPid);
            for (const zPid of zombiePids) {
              await $`taskkill /F /T /PID ${zPid}`.nothrow().quiet();
            }
            if (zombiePids.length > 0) {
              announce(
                `🧹 Swept ${zombiePids.length} zombie process(es)`,
                "Zombie Cleanup",
              );
            }
          } catch {
            /* best effort */
          }
        });
      }

      await retryDatabaseOperation(() => removeProcessByName(name!));
    } else {
      if (!directory || !name || !command) {
        error(
          "'directory', 'name', and 'command' parameters are required for new processes.",
        );
      }
      validateDirectory(directory!);
      $.cwd(directory!);
    }

    const storedCommand = command || existingProcess!.command;
    const finalCommand = resolveInternalBgrunCommand(storedCommand);
    const finalDirectory = directory || existingProcess?.workdir!;
    let finalEnv =
      env || (existingProcess ? parseEnvString(existingProcess.env) : {});

    let finalConfigPath: string | undefined | null;
    if (configPath !== undefined) {
      finalConfigPath = configPath;
    } else if (existingProcess) {
      finalConfigPath = existingProcess.configPath;
    } else {
      finalConfigPath = ".config.toml";
    }

    if (finalConfigPath) {
      const fullConfigPath = join(finalDirectory, finalConfigPath);

      if (await Bun.file(fullConfigPath).exists()) {
        const configEnv = await run.measure(
          `Parse config "${finalConfigPath}"`,
          async () => {
            try {
              return await parseConfigFile(fullConfigPath);
            } catch (err: any) {
              console.warn(
                `Warning: Failed to parse config file ${finalConfigPath}: ${err.message}`,
              );
              return null;
            }
          },
        );
        if (configEnv) {
          finalEnv = { ...finalEnv, ...configEnv };
          console.log(`Loaded config from ${finalConfigPath}`);
        }
      } else {
        console.log(
          `Config file '${finalConfigPath}' not found, continuing without it.`,
        );
      }
    }

    const requestedPort = getDeclaredPort(finalEnv, finalCommand);
    if (requestedPort) {
      const portFree = await isPortFree(requestedPort);
      if (!portFree) {
        if (force) {
          await killProcessOnPort(requestedPort);
          const freed = await waitForPortFree(requestedPort, 5000);
          if (!freed) {
            error(
              `Port ${requestedPort} is still in use. Could not reclaim it for '${name}'.`,
            );
          }
        } else {
          error(
            `Port ${requestedPort} is already in use. Refusing to start '${name}' without --force.`,
          );
        }
      }
    }

    const stdoutPath =
      stdout ||
      existingProcess?.stdout_path ||
      join(homePath, ".bgr", `${name}-out.txt`);
    Bun.write(stdoutPath, "");
    const stderrPath =
      stderr ||
      existingProcess?.stderr_path ||
      join(homePath, ".bgr", `${name}-err.txt`);
    Bun.write(stderrPath, "");

    const actualPid =
      (await run.measure(`Spawn "${name}" → ${finalCommand}`, async () => {
        const newProcess = Bun.spawn(getShellCommand(finalCommand!), {
          env: buildManagedProcessEnv(
            Bun.env as Record<string, string | undefined>,
            finalEnv,
          ),
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
      })) ?? 0;

    await retryDatabaseOperation(() =>
      insertProcess({
        pid: actualPid,
        workdir: finalDirectory,
        command: finalCommand!,
        name: name!,
        env: stringifyEnvString(finalEnv),
        configPath: finalConfigPath || "",
        stdout_path: stdoutPath,
        stderr_path: stderrPath,
      }),
    );

    if (!isInternalProcessName(name!)) {
      await syncProcessWatcher(name!, finalEnv);
    }

    announce(
      `${existingProcess ? "🔄 Restarted" : "🚀 Launched"} process "${name}" with PID ${actualPid}`,
      "Process Started",
    );
  } finally {
    releaseOperationLock();
  }
}
