/**
 * BGR Public API (package: bgrun)
 *
 * Import from 'bgrun' to use these functions in your own process-managing apps.
 */

// --- Types ---
export type { Process } from './db'
export type { CommandOptions } from './types'

// --- Database Operations ---
export {
    db,
    getAllProcesses,
    getProcess,
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
    addHistoryEntry,
    getDependencyGraph,
    addDependency,
    removeDependency,
    getStartOrder,
    retryDatabaseOperation,
    getDbInfo,
    dbPath,
    bgrHome,
} from './db'

// --- Process Operations ---
export {
    isProcessRunning,
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
    getProcessMemory,
    reconcileProcessPids,
    resolvePidWithPorts,
} from './platform'

// --- High-Level Commands ---
export { handleRun } from './commands/run'
export { handleStop } from './commands/cleanup'
export { getManagedChildProcesses } from './managed-children'
export { handleEnvit, parseEnvitArgs, renderEnvitOutput } from './commands/envit'
export { handleInline, parseInlineArgs } from './commands/inline'
export { ensureProcessWatcher, stopProcessWatcher, syncProcessWatcher, getGuardRestartCounts, getRecentGuardEvents } from './watcher'

// --- Utilities ---
export { getVersion, calculateRuntime, parseEnvString, parseCommandEnv, getDeclaredPort, validateDirectory, acquireProcessOperationLock, isProcessOperationLocked, stringifyEnvString, getWatcherProcessName, getWatchedProcessName, isWatcherProcessName, isInternalProcessName } from './utils'

// --- Default Export (namespace style) ---
import {
    db,
    getAllProcesses,
    getProcess,
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
    addHistoryEntry,
    getDependencyGraph,
    addDependency,
    removeDependency,
    getStartOrder,
    retryDatabaseOperation,
    getDbInfo,
    dbPath,
    bgrHome,
} from './db'
import { isProcessRunning, terminateProcess, readFileTail, getProcessPorts, findChildPid, findPidByPort, getShellCommand, killProcessOnPort, waitForPortFree, ensureDir, getHomeDir, isWindows, getProcessBatchResources, getProcessMemory, reconcileProcessPids, resolvePidWithPorts } from './platform'
import { handleRun } from './commands/run'
import { handleStop } from './commands/cleanup'
import { getManagedChildProcesses } from './managed-children'
import { handleEnvit, parseEnvitArgs, renderEnvitOutput } from './commands/envit'
import { handleInline, parseInlineArgs } from './commands/inline'
import { ensureProcessWatcher, stopProcessWatcher, syncProcessWatcher, getGuardRestartCounts, getRecentGuardEvents } from './watcher'
import { getVersion, calculateRuntime, parseEnvString, parseCommandEnv, getDeclaredPort, validateDirectory, acquireProcessOperationLock, isProcessOperationLocked, stringifyEnvString, getWatcherProcessName, getWatchedProcessName, isWatcherProcessName, isInternalProcessName } from './utils'

export default {
    db, getAllProcesses, getProcess, insertProcess, removeProcess, removeProcessByName, removeAllProcesses,
    updateProcessPid, updateProcessEnv, getAllTemplates, saveTemplate, deleteTemplate,
    getProcessHistory, getRecentHistory, addHistoryEntry,
    getDependencyGraph, addDependency, removeDependency, getStartOrder,
    retryDatabaseOperation, getDbInfo, dbPath, bgrHome,
    isProcessRunning, terminateProcess, readFileTail, getProcessPorts, findChildPid, findPidByPort, getShellCommand, killProcessOnPort, waitForPortFree, ensureDir, getHomeDir, isWindows, getProcessBatchResources, getProcessMemory, reconcileProcessPids, resolvePidWithPorts,
    handleRun,
    handleStop,
    getManagedChildProcesses,
    handleEnvit,
    parseEnvitArgs,
    renderEnvitOutput,
    handleInline,
    parseInlineArgs,
    ensureProcessWatcher, stopProcessWatcher, syncProcessWatcher, getGuardRestartCounts, getRecentGuardEvents,
    getVersion, calculateRuntime, parseEnvString, parseCommandEnv, getDeclaredPort, validateDirectory, acquireProcessOperationLock, isProcessOperationLocked, stringifyEnvString, getWatcherProcessName, getWatchedProcessName, isWatcherProcessName, isInternalProcessName,
}
