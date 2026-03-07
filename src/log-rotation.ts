/**
 * Log rotation for bgrun process output files.
 * 
 * Ensures log files don't grow unbounded by:
 * 1. Truncating on rotation (restart) — keeping last N lines
 * 2. Size-based rotation — when file exceeds maxBytes, trim to last N lines
 * 3. Periodic rotation check — runs on an interval in the dashboard
 */

import { existsSync, statSync, readFileSync, writeFileSync } from 'fs'

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024  // 10 MB
const DEFAULT_KEEP_LINES = 5000             // Keep last 5000 lines on rotation
const DEFAULT_CHECK_INTERVAL_MS = 60_000    // Check every 60s

/** Rotate a single log file if it exceeds maxBytes */
export function rotateLogFile(
    filePath: string,
    maxBytes: number = DEFAULT_MAX_BYTES,
    keepLines: number = DEFAULT_KEEP_LINES,
): boolean {
    try {
        if (!existsSync(filePath)) return false

        const stat = statSync(filePath)
        if (stat.size <= maxBytes) return false

        // Read file, keep last N lines
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        if (lines.length <= keepLines) return false

        const truncated = lines.slice(-keepLines)
        const header = `--- [bgrun] Log rotated at ${new Date().toISOString()} (was ${lines.length} lines, ${formatBytes(stat.size)}) ---\n`
        writeFileSync(filePath, header + truncated.join('\n'))

        return true
    } catch {
        return false
    }
}

/** Rotate all log files for all processes */
export function rotateAllLogs(
    getProcesses: () => Array<{ name: string; stdout_path: string; stderr_path: string }>,
    maxBytes: number = DEFAULT_MAX_BYTES,
    keepLines: number = DEFAULT_KEEP_LINES,
): { rotated: string[]; checked: number } {
    const processes = getProcesses()
    const rotated: string[] = []
    let checked = 0

    for (const proc of processes) {
        if (proc.stdout_path) {
            checked++
            if (rotateLogFile(proc.stdout_path, maxBytes, keepLines)) {
                rotated.push(`${proc.name}/stdout`)
            }
        }
        if (proc.stderr_path) {
            checked++
            if (rotateLogFile(proc.stderr_path, maxBytes, keepLines)) {
                rotated.push(`${proc.name}/stderr`)
            }
        }
    }

    return { rotated, checked }
}

/** Start periodic log rotation */
export function startLogRotation(
    getProcesses: () => Array<{ name: string; stdout_path: string; stderr_path: string }>,
    intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
    maxBytes: number = DEFAULT_MAX_BYTES,
    keepLines: number = DEFAULT_KEEP_LINES,
): ReturnType<typeof setInterval> {
    console.log(`[logs] Log rotation active: max ${formatBytes(maxBytes)}/file, keep ${keepLines} lines, check every ${intervalMs / 1000}s`)

    return setInterval(() => {
        const { rotated } = rotateAllLogs(getProcesses, maxBytes, keepLines)
        if (rotated.length > 0) {
            console.log(`[logs] Rotated ${rotated.length} log(s): ${rotated.join(', ')}`)
        }
    }, intervalMs)
}

function formatBytes(bytes: number): string {
    if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`
    if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)}KB`
    return `${bytes}B`
}
