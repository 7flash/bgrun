/**
 * bgrun public API.
 *
 * Prefer the instance SDK (`createBgrun`) or the lazy default singleton.
 * Low-level exports remain available for compatibility and advanced tooling.
 */

export type {
  Bgrun,
  BgrunOptions,
  BgrunSingleton,
  ListOptions,
  LogOptions,
  ManagedProcess,
  ProcessLogs,
  RestartOptions,
  StartOptions,
} from "./sdk";
export {
  bgrun,
  configure,
  configureDefaultBgrun,
  createBgrun,
  ensure,
  get,
  getDefaultBgrun,
  list,
  logs,
  remove,
  resources,
  restart,
  start,
  stop,
} from "./sdk";

export type { Process, History } from "./db";
export type { SystemProcessResource } from "./platform";
export type {
  GuardEvent,
  GuardRestartMetadata,
  GuardRestartReason,
} from "./history-events";
export type { CommandOptions } from "./types";

export {
  db,
  getDb,
  getAllProcesses,
  getCurrentProcesses,
  getProcess,
  clearProcessOwnership,
  updateProcessOwnership,
  insertProcess,
  removeProcess,
  removeProcessByName,
  removeAllProcesses,
  updateProcessPid,
  updateProcessEnv,
  getAllTemplates,
  saveTemplate,
  deleteTemplate,
  getProcessHistory,
  getRecentHistory,
  getHistoryByEvent,
  getRecentHistoryByEvents,
  addHistoryEntry,
  getDependencyGraph,
  addDependency,
  removeDependency,
  getStartOrder,
  retryDatabaseOperation,
  getDbInfo,
  dbPath,
  bgrHome,
} from "./db";

export {
  isProcessRunning,
  isManagedProcessRunning,
  findManagedProcessPid,
  terminateProcess,
  readFileTail,
  getProcessPorts,
  findChildPid,
  findPidByPort,
  getShellCommand,
  killProcessOnPort,
  waitForPortFree,
  ensureDir,
  getHomeDir,
  isWindows,
  getProcessBatchResources,
  getSystemProcessResources,
  getListeningPortsByPid,
  getProcessMemory,
  reconcileProcessPids,
  resolvePidWithPorts,
} from "./platform";

/** @deprecated Prefer `bgrun.start()` or `createBgrun().start()`. */
export { handleRun } from "./commands/run";
/** @deprecated Prefer `bgrun.stop()` or `createBgrun().stop()`. */
export { handleStop, stopProcess, deleteProcess } from "./commands/cleanup";
export { getManagedChildProcesses } from "./managed-children";
export {
  handleEnvit,
  parseEnvitArgs,
  renderEnvitOutput,
} from "./commands/envit";
export { handleInline, parseInlineArgs } from "./commands/inline";
export {
  ensureProcessWatcher,
  stopProcessWatcher,
  syncProcessWatcher,
  getGuardRestartCounts,
  getRecentGuardEvents,
} from "./watcher";

export type {
  ResourceSnapshotRow,
  ResourceSnapshotOptions,
  ResourceSort,
} from "./resource-monitor";
export {
  sampleManagedResources,
  sampleSystemResources,
  sortResourceRows,
} from "./resource-monitor";

export { getErrorCode, getErrorMessage, hasErrorCode } from "./error-utils";
export {
  historyRowToGuardEvent,
  parseGuardRestartMetadata,
} from "./history-events";
export {
  TimeoutError,
  retry,
  withTimeout,
  withTimeoutFallback,
} from "./async-utils";
export {
  getVersion,
  calculateRuntime,
  parseEnvString,
  parseCommandEnv,
  getDeclaredPort,
  validateDirectory,
  acquireProcessOperationLock,
  isProcessOperationLocked,
  stringifyEnvString,
  getWatcherProcessName,
  getWatchedProcessName,
  isWatcherProcessName,
  isInternalProcessName,
} from "./utils";

import { bgrun as sdkBgrun } from "./sdk";
import * as legacyDb from "./db";
import * as legacyPlatform from "./platform";
import * as legacyUtils from "./utils";
import { handleRun as legacyHandleRun } from "./commands/run";
import { handleStop as legacyHandleStop } from "./commands/cleanup";
import { getManagedChildProcesses as legacyManagedChildren } from "./managed-children";
import * as legacyWatcher from "./watcher";
import * as legacyResources from "./resource-monitor";

const legacyDefault = {
  ...legacyDb,
  ...legacyPlatform,
  ...legacyUtils,
  ...legacyWatcher,
  ...legacyResources,
  handleRun: legacyHandleRun,
  handleStop: legacyHandleStop,
  getManagedChildProcesses: legacyManagedChildren,
};

Object.defineProperties(legacyDefault, {
  dbPath: { enumerable: true, get: () => legacyDb.dbPath },
  bgrHome: { enumerable: true, get: () => legacyDb.bgrHome },
});

const defaultExport = new Proxy(
  sdkBgrun as typeof sdkBgrun & typeof legacyDefault,
  {
    get(target, property, receiver) {
      const sdkValue = Reflect.get(target, property, receiver);
      if (sdkValue !== undefined) return sdkValue;
      const value = Reflect.get(legacyDefault, property);
      return typeof value === "function" ? value.bind(legacyDefault) : value;
    },
  },
);

export default defaultExport;
