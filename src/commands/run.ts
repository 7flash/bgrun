import type { CommandOptions } from "../types";
import {
  addHistoryEntry,
  getProcess,
  replaceProcess,
  retryDatabaseOperation,
  updateProcessOwnership,
} from "../db";
import {
  findManagedProcessPid,
  inspectManagedProcess,
  isManagedProcessRunning,
  isProcessRunning,
  terminateProcess,
  getShellCommand,
} from "../platform";
import { getProcessBirthId } from "../process-identity";
import { announce } from "../logger";
import {
  validateDirectory,
  buildManagedProcessEnv,
  acquireProcessOperationLock,
  isInternalProcessName,
  stringifyEnvString,
} from "../utils";
import { parseConfigFile } from "../config";
import { existsSync, mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { syncProcessWatcher } from "../watcher";
import { getBgrHome, getDatabasePath, canonicalPath } from "../paths";
import { readLogTail } from "../log-io";
import { resolveInternalBgrunCommand } from "../internal-command";
import { acquireCheckoutOperationLock } from "../operation-locks";
import { ProcessMonitoringSetupError } from "../lifecycle-state";
import { cleanupOwnedChild, type OwnedChild } from "../spawn-cleanup";
import { resolveProcessEnvironment } from "../process-environment";

export { resolveInternalBgrunCommand } from "../internal-command";

function validateName(name: string | undefined): asserts name is string {
  const maxBytes = name && isInternalProcessName(name) ? 240 : 160;
  if (
    !name?.trim() ||
    name !== name.trim() ||
    /[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) ||
    name.endsWith(".") ||
    Buffer.byteLength(name) > maxBytes
  ) {
    throw new Error(
      "Process name must be nonempty, at most 160 bytes (240 for internal names), and contain no path separators, control characters, or characters invalid in Windows filenames",
    );
  }
}

function startupGrace(): number {
  const raw = Number(process.env.BGR_STARTUP_HEALTH_GRACE_MS ?? 1500);
  return Number.isFinite(raw) && raw >= 0 && raw <= 60000 ? raw : 1500;
}

async function waitForStartupHealth(
  pid: number,
  name: string,
  birth: string,
  command: string,
): Promise<boolean> {
  const deadline = Date.now() + startupGrace();
  do {
    const alive = birth
      ? (await inspectManagedProcess(pid, name, birth, command)) === "alive"
      : await isProcessRunning(pid, command);
    if (!alive) return false;
    if (Date.now() >= deadline) return true;
    await Bun.sleep(Math.min(100, deadline - Date.now()));
  } while (true);
}

function startupFailure(name: string, stdout: string, stderr: string): Error {
  const tail = (path: string) => {
    try {
      return readLogTail(path, 20, 64 * 1024).trim();
    } catch {
      return "";
    }
  };
  return new Error(
    `Process "${name}" failed to stay running after launch.\nstdout: ${stdout}\nstderr: ${stderr}\n${tail(stderr)}\n${tail(stdout)}`,
  );
}

async function runGit(directory: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderrText.trim() || `git ${args.join(" ")} failed`);
  }
  return stdoutText.trim();
}

async function updateGitCheckout(directory: string): Promise<boolean> {
  if (!existsSync(join(directory, ".git"))) {
    throw new Error(`Cannot --fetch: '${directory}' is not a Git repository.`);
  }
  await runGit(directory, ["fetch", "origin"]);
  const localHash = await runGit(directory, ["rev-parse", "HEAD"]);
  const branch = await runGit(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const remoteHash = await runGit(directory, ["rev-parse", `origin/${branch}`]);
  if (localHash === remoteHash) return false;
  await runGit(directory, ["pull", "--ff-only", "origin", branch]);
  return true;
}

export type RunProcessResult = {
  process: NonNullable<ReturnType<typeof getProcess>>;
  restarted: boolean;
};

export async function runProcess(
  options: CommandOptions,
): Promise<RunProcessResult> {
  const name = options.name;
  validateName(name);

  if (
    options.dbPath &&
    canonicalPath(resolve(getBgrHome(), options.dbPath)) !==
      canonicalPath(getDatabasePath())
  ) {
    throw new Error(
      "Set BGRUN_DB before importing the API; a running API instance cannot switch databases",
    );
  }

  const release = acquireProcessOperationLock(name);
  try {
    let existing = getProcess(name);
    const directory = resolve(
      options.directory || existing?.workdir || process.cwd(),
    );
    validateDirectory(directory);

    const command = resolveInternalBgrunCommand(
      options.command ?? existing?.command ?? "",
    );
    if (!command.trim() || command.includes("\0")) {
      throw new Error("A nonempty command is required");
    }

    const argv: unknown =
      options.argv ??
      (options.command === undefined && existing?.argv
        ? JSON.parse(existing.argv)
        : undefined);
    if (
      argv !== undefined &&
      (!Array.isArray(argv) ||
        argv.length === 0 ||
        argv.some((arg) => typeof arg !== "string" || arg.includes("\0")))
    ) {
      throw new Error("argv must be a nonempty string array without NUL bytes");
    }
    const spawnArgs = argv as string[] | undefined;

    const configPath =
      options.configPath ?? existing?.configPath ?? ".config.toml";
    const defaults: Record<string, string> = {};
    if (!existing && !isInternalProcessName(name)) {
      if (Bun.env.BGR_DEPENDS_ON) {
        defaults.BGR_DEPENDS_ON = Bun.env.BGR_DEPENDS_ON;
      }
      if (Bun.env.BGR_GROUP) defaults.BGR_GROUP = Bun.env.BGR_GROUP;
      const parent = options.parent?.trim() || Bun.env.BGR_PROCESS_NAME;
      if (parent && parent !== name && !isInternalProcessName(parent))
        defaults.BGR_PARENT_NAME = parent;
    }

    let configEnv: Record<string, string> = {};
    if (configPath) {
      const fullPath = resolve(directory, configPath);
      if (existsSync(fullPath)) {
        configEnv = await parseConfigFile(fullPath);
      } else if (options.configPath) {
        throw new Error(`Config file '${fullPath}' not found`);
      }
    }

    const { env, sources } = resolveProcessEnvironment(
      existing,
      configEnv,
      options.env,
      defaults,
    );
    if (options.detached || options.parent === null) {
      delete env.BGR_PARENT_NAME;
      delete env.BGRUN_PARENT_NAME;
    } else if (options.parent !== undefined) {
      const parent = options.parent.trim();
      if (!parent || parent === name || isInternalProcessName(parent)) {
        throw new Error("Parent must name a different, non-internal process");
      }
      env.BGR_PARENT_NAME = parent;
      delete env.BGRUN_PARENT_NAME;
    }
    env.BGR_PROCESS_NAME = name;
    const storedEnv = stringifyEnvString(env);

    const stdoutPath = resolve(
      options.stdout ||
        (options.logsDir
          ? join(options.logsDir, `${name}-out.txt`)
          : existing?.stdout_path || join(getBgrHome(), `${name}-out.txt`)),
    );
    const stderrPath = resolve(
      options.stderr ||
        (options.logsDir
          ? join(options.logsDir, `${name}-err.txt`)
          : existing?.stderr_path || join(getBgrHome(), `${name}-err.txt`)),
    );
    mkdirSync(dirname(stdoutPath), { recursive: true });
    mkdirSync(dirname(stderrPath), { recursive: true });

    let observed = existing
      ? await inspectManagedProcess(
          existing.pid,
          name,
          existing.start_identity,
          existing.command,
        )
      : "dead";

    if (existing && (observed === "dead" || observed === "mismatch")) {
      const recoveredPid = await findManagedProcessPid(
        existing.name,
        existing.command,
        existing.workdir,
      );
      if (recoveredPid && recoveredPid !== existing.pid) {
        const recoveredBirth = getProcessBirthId(recoveredPid);
        await retryDatabaseOperation(() =>
          updateProcessOwnership(name, recoveredPid, recoveredBirth),
        );
        existing = getProcess(name);
        observed = existing
          ? await inspectManagedProcess(
              existing.pid,
              name,
              existing.start_identity,
              existing.command,
            )
          : "dead";
      }
    }

    const owned = observed === "alive";

    if (owned && !options.force) {
      throw new Error(
        `Process '${name}' is currently running. Use --force to restart.`,
      );
    }
    if (existing && observed === "unknown") {
      throw new Error(
        `Cannot prove ownership of stored PID ${existing.pid} for '${name}'. Refusing to stop it or start a duplicate.`,
      );
    }

    const { getDependencyStartPlan } = await import("../deps");
    const dependencies = getDependencyStartPlan(name, storedEnv);
    for (const dependency of dependencies) {
      const proc = getProcess(dependency);
      if (!proc) {
        throw new Error(`Dependency '${dependency}' is no longer registered`);
      }
      if (
        !(await isManagedProcessRunning(
          proc.pid,
          proc.name,
          proc.command,
          proc.start_identity,
        ))
      ) {
        await runProcess({ name: dependency });
      }
    }

    if (options.fetch) {
      const releaseCheckout = acquireCheckoutOperationLock(directory);
      try {
        await updateGitCheckout(directory);
      } finally {
        releaseCheckout();
      }
    }

    const outFd = openSync(stdoutPath, "a", 0o600);
    let errFd: number | undefined;
    let spawnedPid = 0;
    let birth = "";
    let registered = false;
    let child: OwnedChild | undefined;

    const definition = {
      name,
      pid: 0,
      command,
      workdir: directory,
      env: storedEnv,
      env_sources: JSON.stringify(sources),
      configPath,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      start_identity: "",
      argv: spawnArgs ? JSON.stringify(spawnArgs) : "",
    };

    try {
      errFd = openSync(stderrPath, "a", 0o600);

      if (owned) {
        const currentState = await inspectManagedProcess(
          existing!.pid,
          name,
          existing!.start_identity,
          existing!.command,
        );
        if (currentState === "unknown") {
          throw new Error(
            `Ownership of PID ${existing!.pid} became uncertain before replacement`,
          );
        }
        if (currentState === "alive") {
          await terminateProcess(
            existing!.pid,
            false,
            existing!.start_identity || undefined,
          );
        }
      }

      const spawnedChild = Bun.spawn(spawnArgs ?? getShellCommand(command), {
        cwd: directory,
        env: buildManagedProcessEnv(Bun.env, env, sources.removed),
        stdin: "ignore",
        stdout: outFd,
        stderr: errFd,
        detached: true,
      }) as OwnedChild;
      child = spawnedChild;
      spawnedPid = spawnedChild.pid;
      birth = getProcessBirthId(spawnedPid);

      if (!(await waitForStartupHealth(spawnedPid, name, birth, command))) {
        throw startupFailure(name, stdoutPath, stderrPath);
      }

      await retryDatabaseOperation(() =>
        replaceProcess({
          ...definition,
          pid: spawnedPid,
          start_identity: birth,
        }),
      );
      registered = true;
      child.unref();
    } catch (error) {
      if (!registered && child) {
        try {
          await cleanupOwnedChild(child, birth, terminateProcess);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Launch failed and cleanup of locally-owned process '${name}' could not be confirmed`,
          );
        }
      }
      throw error;
    } finally {
      for (const fd of [outFd, errFd]) {
        if (fd !== undefined) closeSync(fd);
      }
    }

    addHistoryEntry(name, existing ? "restart" : "start", spawnedPid);

    if (!isInternalProcessName(name)) {
      try {
        await syncProcessWatcher(name, env);
      } catch (error) {
        throw new ProcessMonitoringSetupError(name, spawnedPid, error);
      }
    }

    const current = getProcess(name);
    if (!current) {
      throw new Error(
        `Process '${name}' was launched but not found in the registry`,
      );
    }
    return { process: current, restarted: Boolean(existing) };
  } finally {
    release();
  }
}

export async function handleRun(options: CommandOptions): Promise<void> {
  const result = await runProcess(options);
  announce(
    `${result.restarted ? "Restarted" : "Launched"} process "${result.process.name}" with PID ${result.process.pid}`,
    "Process Started",
  );
}
