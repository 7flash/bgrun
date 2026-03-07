/**
 * POST /api/logs/rotate — Rotate all log files
 * GET  /api/logs/rotate — Get log file sizes
 */

import { getAllProcesses } from '../../../../../src/db'
import { rotateAllLogs } from '../../../../../src/log-rotation'
import { existsSync, statSync } from 'fs'

export function POST() {
    const result = rotateAllLogs(() => getAllProcesses())
    return Response.json({
        ok: true,
        rotated: result.rotated,
        checked: result.checked,
    })
}

export function GET() {
    const processes = getAllProcesses()
    const files: Array<{ name: string; type: string; path: string; sizeBytes: number; sizeMB: string }> = []

    for (const proc of processes) {
        for (const [type, path] of [['stdout', proc.stdout_path], ['stderr', proc.stderr_path]] as const) {
            if (path && existsSync(path)) {
                const stat = statSync(path)
                files.push({
                    name: proc.name,
                    type,
                    path,
                    sizeBytes: stat.size,
                    sizeMB: (stat.size / 1_000_000).toFixed(2),
                })
            }
        }
    }

    const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)

    return Response.json({
        files,
        totalBytes,
        totalMB: (totalBytes / 1_000_000).toFixed(2),
    })
}
