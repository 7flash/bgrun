/**
 * BGR Public API (package: bgrun)
 * 
 * Import from 'bgrun' to use these functions in your own process-managing apps.
 * 
 * @example
 * ```ts
 * import { getAllProcesses, isProcessRunning, handleRun } from 'bgrun'
 * 
 * // List all managed processes
 * const processes = getAllProcesses()
 * 
 * // Check if a process is running
 * const alive = await isProcessRunning(process.pid)
 * 
 * // Start a new managed process
 * await handleRun({ name: 'my-app', command: 'bun run dev', directory: './my-app', action: 'run', remoteName: '' })
 * ```
 */

// --- Types ---
export type { Process } from './db'
export type { CommandOptions } from './types'

// --- Database Operations ---
export { db, getAllProcesses, getProcess, insertProcess, removeProcess, removeProcessByName, removeAllProcesses, retryDatabaseOperation, getDbInfo, dbPath, bgrHome } from './db'

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
    getProcessMemory
} from './platform'

// --- High-Level Commands ---
export { handleRun } from './commands/run'

// --- Utilities ---
export { getVersion, calculateRuntime, parseEnvString, validateDirectory } from './utils'

// --- Default Export (namespace style) ---
import { getAllProcesses, getProcess, insertProcess, removeProcess, removeProcessByName, removeAllProcesses, retryDatabaseOperation, getDbInfo, dbPath, bgrHome } from './db'
import { isProcessRunning, terminateProcess, readFileTail, getProcessPorts, findChildPid, findPidByPort, getShellCommand, killProcessOnPort, waitForPortFree, ensureDir, getHomeDir, isWindows, getProcessBatchResources, getProcessMemory } from './platform'
import { handleRun } from './commands/run'
import { getVersion, calculateRuntime, parseEnvString, validateDirectory } from './utils'

export default {
    getAllProcesses, getProcess, insertProcess, removeProcess, removeProcessByName, removeAllProcesses, retryDatabaseOperation, getDbInfo, dbPath, bgrHome,
    isProcessRunning, terminateProcess, readFileTail, getProcessPorts, findChildPid, findPidByPort, getShellCommand, killProcessOnPort, waitForPortFree, ensureDir, getHomeDir, isWindows, getProcessBatchResources, getProcessMemory,
    handleRun,
    getVersion, calculateRuntime, parseEnvString, validateDirectory,
}
