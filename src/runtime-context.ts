import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface BgrunRuntimeOptions {
  home?: string;
  db?: string;
}

export interface ResolvedBgrunRuntime {
  home: string;
  dbPath: string;
  key: string;
}

const storage = new AsyncLocalStorage<ResolvedBgrunRuntime>();
let defaultOptions: BgrunRuntimeOptions = {};
let defaultRuntime: ResolvedBgrunRuntime | undefined;
const defaultListeners = new Set<(runtime: ResolvedBgrunRuntime) => void>();

export function resolveBgrunRuntime(
  options: BgrunRuntimeOptions = {},
): ResolvedBgrunRuntime {
  const home = resolve(
    options.home?.trim() ||
      process.env.BGRUN_HOME?.trim() ||
      join(homedir(), ".bgr"),
  );
  const configuredDb =
    options.db?.trim() || process.env.BGRUN_DB?.trim() || "bgrun.sqlite";
  const dbPath = isAbsolute(configuredDb)
    ? resolve(configuredDb)
    : resolve(home, configuredDb);
  return { home, dbPath, key: `${home}\0${dbPath}` };
}

export function peekDefaultBgrunRuntime(): ResolvedBgrunRuntime {
  return resolveBgrunRuntime(defaultOptions);
}

export function configureDefaultBgrunRuntime(
  options: BgrunRuntimeOptions,
): void {
  if (defaultRuntime) {
    throw new Error("Default bgrun instance has already been initialized");
  }
  defaultOptions = { ...defaultOptions, ...options };
  const runtime = peekDefaultBgrunRuntime();
  for (const listener of defaultListeners) listener(runtime);
}

export function getDefaultBgrunRuntime(): ResolvedBgrunRuntime {
  if (!defaultRuntime) {
    defaultRuntime = peekDefaultBgrunRuntime();
    for (const listener of defaultListeners) listener(defaultRuntime);
  }
  return defaultRuntime;
}

export function getActiveBgrunRuntime(): ResolvedBgrunRuntime {
  return storage.getStore() ?? getDefaultBgrunRuntime();
}

export function withBgrunRuntime<T>(
  runtime: ResolvedBgrunRuntime,
  operation: () => T,
): T {
  return storage.run(runtime, operation);
}

export function onDefaultBgrunRuntimeChange(
  listener: (runtime: ResolvedBgrunRuntime) => void,
): () => void {
  defaultListeners.add(listener);
  listener(peekDefaultBgrunRuntime());
  return () => defaultListeners.delete(listener);
}
