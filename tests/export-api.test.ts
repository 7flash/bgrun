import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'

const testDbName = `bgrun-export-api-${Date.now()}.sqlite`
process.env.BGRUN_DB = testDbName
process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'

const tempDir = join(import.meta.dir, 'export_api_tmp')
const historyProcess = 'export-history-proc'
const logProcess = 'export-log-proc'

let dbMod: typeof import('../src/db')
let historyRoute: typeof import('../dashboard/app/api/history/route')
let logsRoute: typeof import('../dashboard/app/api/logs/[name]/route')

function cleanupHistoryEntries(processName: string) {
  const rows = dbMod.db.history.select().where({ process_name: processName }).all() as Array<{ id: number }>
  for (const row of rows) dbMod.db.history.delete(row.id)
}

beforeAll(async () => {
  mkdirSync(tempDir, { recursive: true })
  dbMod = await import('../src/db')
  historyRoute = await import('../dashboard/app/api/history/route')
  logsRoute = await import('../dashboard/app/api/logs/[name]/route')
})

afterAll(() => {
  cleanupHistoryEntries(historyProcess)
  cleanupHistoryEntries(logProcess)
  dbMod.removeProcessByName(logProcess)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('export API routes', () => {
  test('history route exports filtered CSV', async () => {
    cleanupHistoryEntries(historyProcess)
    dbMod.addHistoryEntry(historyProcess, 'deploy', 1234, { status: 'ok', branch: 'main' })
    dbMod.addHistoryEntry(historyProcess, 'restart', 1234, { status: 'ignored', branch: 'dev' })

    const req = new Request(`http://localhost/api/history?name=${encodeURIComponent(historyProcess)}&event=deploy&metadata=main&format=csv&download=1`)
    const res = await historyRoute.GET(req)
    const text = await res.text()

    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(res.headers.get('content-disposition')).toContain('bgr-history')
    expect(text).toContain('process_name,event,pid,timestamp,metadata')
    expect(text).toContain(`${historyProcess},deploy,1234,`)
    expect(text).toContain('"{""status"":""ok"",""branch"":""main""}"')
    expect(text).not.toContain('restart')
  })

  test('logs route exports plain text', async () => {
    dbMod.removeProcessByName(logProcess)
    const stdoutPath = join(tempDir, 'stdout.log')
    const stderrPath = join(tempDir, 'stderr.log')
    await writeFile(stdoutPath, 'first line\nsecond line\n')
    await writeFile(stderrPath, 'err line\n')
    dbMod.insertProcess({
      pid: 4321,
      name: logProcess,
      workdir: tempDir,
      command: 'bun run fake',
      env: '',
      configPath: '',
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
    })

    const req = new Request(`http://localhost/api/logs/${encodeURIComponent(logProcess)}?tab=stdout&format=text&download=1`)
    const res = await logsRoute.GET(req, { params: { name: logProcess } })
    const text = await res.text()

    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.headers.get('content-disposition')).toContain(`${encodeURIComponent(logProcess)}-stdout.log`)
    expect(text).toBe('first line\nsecond line\n')
  })

  test('logs route exports CSV with line numbers', async () => {
    const req = new Request(`http://localhost/api/logs/${encodeURIComponent(logProcess)}?tab=stdout&format=csv`)
    const res = await logsRoute.GET(req, { params: { name: logProcess } })
    const text = await res.text()

    expect(res.headers.get('content-type')).toContain('text/csv')
    expect(text).toContain('line,text')
    expect(text).toContain('1,first line')
    expect(text).toContain('2,second line')
  })

  test('logs route exports JSON metadata payload', async () => {
    const req = new Request(`http://localhost/api/logs/${encodeURIComponent(logProcess)}?tab=stderr&format=json&download=1`)
    const res = await logsRoute.GET(req, { params: { name: logProcess } })
    const json = await res.json() as { text: string; size: number; mtime: string | null; filePath: string }

    expect(res.headers.get('content-disposition')).toContain(`${encodeURIComponent(logProcess)}-stderr.json`)
    expect(json.text).toBe('err line\n')
    expect(json.size).toBeGreaterThan(0)
    expect(json.mtime).toBeTruthy()
    expect(json.filePath).toContain('stderr.log')
  })
})
