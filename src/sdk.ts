import { resolve } from "node:path";
import { getCurrentProcesses, getProcess, type Process } from "./db";
import { runProcess } from "./commands/run";
import { deleteProcess, stopProcess } from "./commands/cleanup";
import { inspectManagedProcessSnapshot } from "./process-snapshot";
import { readFileTail } from "./platform";
import {
  sampleManagedResources,
  type ResourceSnapshotOptions,
  type ResourceSnapshotRow,
} from "./resource-monitor";
import { isInternalProcessName, parseEnvString } from "./utils";
import {
  configureDefaultBgrunRuntime,
  getDefaultBgrunRuntime,
  resolveBgrunRuntime,
  withBgrunRuntime,
  type BgrunRuntimeOptions,
  type ResolvedBgrunRuntime,
} from "./runtime-context";

export interface BgrunOptions extends BgrunRuntimeOptions {}

export interface StartOptions {
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  config?: string;
  fetch?: boolean;
  logsDir?: string;
  stdout?: string;
  stderr?: string;
  argv?: string[];
  /** Explicit lifecycle parent override. */
  parent?: string | null;
  /** Do not link this process to the calling managed process. */
  detached?: boolean;
}

export interface RestartOptions {
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  config?: string;
  fetch?: boolean;
  logsDir?: string;
  stdout?: string;
  stderr?: string;
  argv?: string[];
  /** Set a lifecycle parent, or pass null to clear an existing link. */
  parent?: string | null;
  /** Clear an existing parent link and keep the process independent. */
  detached?: boolean;
}

export interface ListOptions {
  group?: string;
  status?: "running" | "stopped";
}

export interface LogOptions {
  lines?: number;
}

export interface ProcessLogs {
  stdout: string;
  stderr: string;
}

export interface ManagedProcess {
  name: string;
  status: "running" | "stopped";
  pid: number | null;
  ports: number[];
  command: string;
  cwd: string;
  startedAt: string | null;
  stdoutPath: string;
  stderrPath: string;
  group: string | null;
  parent: string | null;
}

export interface Bgrun {
  readonly home: string;
  readonly dbPath: string;
  start(options: StartOptions): Promise<ManagedProcess>;
  ensure(options: StartOptions): Promise<ManagedProcess>;
  restart(name: string, options?: RestartOptions): Promise<ManagedProcess>;
  stop(name: string): Promise<ManagedProcess>;
  remove(name: string): Promise<void>;
  get(name: string): Promise<ManagedProcess | null>;
  list(options?: ListOptions): Promise<ManagedProcess[]>;
  logs(name: string, options?: LogOptions): Promise<ProcessLogs>;
  resources(options?: ResourceSnapshotOptions): Promise<ResourceSnapshotRow[]>;
}

export interface BgrunSingleton extends Bgrun {
  configure(options: BgrunOptions): void;
}

function commandOptions(
  name: string,
  options: StartOptions | RestartOptions,
  force: boolean,
) {
  return {
    name,
    command: options.command,
    directory: options.cwd,
    env: options.env,
    configPath: options.config,
    fetch: options.fetch,
    logsDir: options.logsDir,
    stdout: options.stdout,
    stderr: options.stderr,
    argv: options.argv,
    parent: options.parent,
    detached: options.detached,
    force,
  };
}

function definitionMatches(proc: Process, options: StartOptions): boolean {
  const cwd = resolve(options.cwd || process.cwd());
  return proc.command === options.command && resolve(proc.workdir) === cwd;
}

class BgrunClient implements Bgrun {
  constructor(private readonly runtime: ResolvedBgrunRuntime) {}

  get home(): string {
    return this.runtime.home;
  }

  get dbPath(): string {
    return this.runtime.dbPath;
  }

  private run<T>(operation: () => T): T {
    return withBgrunRuntime(this.runtime, operation);
  }

  private async describe(proc: Process): Promise<ManagedProcess> {
    return this.run(async () => {
      const snapshot = await inspectManagedProcessSnapshot(proc);
      const env = parseEnvString(proc.env || "");
      return {
        name: proc.name,
        status: snapshot.state,
        pid: snapshot.pid,
        ports: snapshot.ports,
        command: proc.command,
        cwd: proc.workdir,
        startedAt: snapshot.state === "running" ? proc.timestamp : null,
        stdoutPath: proc.stdout_path,
        stderrPath: proc.stderr_path,
        group: env.BGR_GROUP || null,
        parent: env.BGR_PARENT_NAME || env.BGRUN_PARENT_NAME || null,
      };
    });
  }

  async start(options: StartOptions): Promise<ManagedProcess> {
    return this.run(async () => {
      const result = await runProcess(
        commandOptions(options.name, options, false),
      );
      return this.describe(result.process);
    });
  }

  async ensure(options: StartOptions): Promise<ManagedProcess> {
    return this.run(async () => {
      const existing = getProcess(options.name);
      if (!existing) return this.start(options);

      const current = await this.describe(existing);
      if (
        current.status === "running" &&
        definitionMatches(existing, options)
      ) {
        return current;
      }

      const result = await runProcess(
        commandOptions(options.name, options, true),
      );
      return this.describe(result.process);
    });
  }

  async restart(
    name: string,
    options: RestartOptions = {},
  ): Promise<ManagedProcess> {
    return this.run(async () => {
      if (!getProcess(name))
        throw new Error(`No process found named '${name}'`);
      const result = await runProcess(commandOptions(name, options, true));
      return this.describe(result.process);
    });
  }

  async stop(name: string): Promise<ManagedProcess> {
    return this.run(async () => {
      await stopProcess(name);
      const proc = getProcess(name);
      if (!proc) throw new Error(`No process found named '${name}'`);
      return this.describe(proc);
    });
  }

  async remove(name: string): Promise<void> {
    return this.run(() => deleteProcess(name));
  }

  async get(name: string): Promise<ManagedProcess | null> {
    return this.run(async () => {
      const proc = getProcess(name);
      return proc ? this.describe(proc) : null;
    });
  }

  async list(options: ListOptions = {}): Promise<ManagedProcess[]> {
    return this.run(async () => {
      const processes = getCurrentProcesses().filter((proc) => {
        if (isInternalProcessName(proc.name)) return false;
        if (!options.group) return true;
        return parseEnvString(proc.env || "").BGR_GROUP === options.group;
      });
      const rows = await Promise.all(
        processes.map((proc) => this.describe(proc)),
      );
      return options.status
        ? rows.filter((row) => row.status === options.status)
        : rows;
    });
  }

  async logs(name: string, options: LogOptions = {}): Promise<ProcessLogs> {
    return this.run(async () => {
      const proc = getProcess(name);
      if (!proc) throw new Error(`No process found named '${name}'`);
      const lines = Math.max(0, options.lines ?? 100);
      const [stdout, stderr] = await Promise.all([
        readFileTail(proc.stdout_path, lines),
        readFileTail(proc.stderr_path, lines),
      ]);
      return { stdout, stderr };
    });
  }

  async resources(
    options: ResourceSnapshotOptions = {},
  ): Promise<ResourceSnapshotRow[]> {
    return this.run(() => sampleManagedResources(options));
  }
}

export function createBgrun(options: BgrunOptions = {}): Bgrun {
  return new BgrunClient(resolveBgrunRuntime(options));
}

let defaultInstance: Bgrun | undefined;

export function configureDefaultBgrun(options: BgrunOptions): void {
  if (defaultInstance) {
    throw new Error("Default bgrun instance has already been initialized");
  }
  configureDefaultBgrunRuntime(options);
}

export function getDefaultBgrun(): Bgrun {
  return (defaultInstance ??= new BgrunClient(getDefaultBgrunRuntime()));
}

export const configure = configureDefaultBgrun;

export const bgrun = new Proxy({} as BgrunSingleton, {
  get(_target, property) {
    if (property === "configure") return configureDefaultBgrun;
    if (property === "then") return undefined;
    if (property === Symbol.toStringTag) return "Bgrun";
    if (typeof property === "symbol") return undefined;
    const instance = getDefaultBgrun() as unknown as Record<
      PropertyKey,
      unknown
    >;
    const value = Reflect.get(instance, property);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export const start: Bgrun["start"] = (...args) =>
  getDefaultBgrun().start(...args);
export const ensure: Bgrun["ensure"] = (...args) =>
  getDefaultBgrun().ensure(...args);
export const restart: Bgrun["restart"] = (...args) =>
  getDefaultBgrun().restart(...args);
export const stop: Bgrun["stop"] = (...args) => getDefaultBgrun().stop(...args);
export const remove: Bgrun["remove"] = (...args) =>
  getDefaultBgrun().remove(...args);
export const get: Bgrun["get"] = (...args) => getDefaultBgrun().get(...args);
export const list: Bgrun["list"] = (...args) => getDefaultBgrun().list(...args);
export const logs: Bgrun["logs"] = (...args) => getDefaultBgrun().logs(...args);
export const resources: Bgrun["resources"] = (...args) =>
  getDefaultBgrun().resources(...args);
