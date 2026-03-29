import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

setDefaultTimeout(20_000)

const repoRoot = join(import.meta.dir, '..')
const tempRoot = mkdtempSync(join(tmpdir(), 'bgrun-packaged-routes-'))
const installRoot = join(tempRoot, 'app')
const testDbName = `bgrun-installed-routes-${Date.now()}.sqlite`
process.env.BGRUN_DB = testDbName
process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'

let runtimeMod: any
let versionRoute: any
let guardEventsRoute: any
let historyRoute: any

async function runCommand(command: string[], cwd: string, env: Record<string, string | undefined> = Bun.env) {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed in ${cwd}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  }
  return { stdout, stderr }
}

beforeAll(async () => {
  await runCommand(['bun', 'run', 'build'], repoRoot)

  const packed = await runCommand(['npm', 'pack', '--json'], repoRoot)
  const packInfo = JSON.parse(packed.stdout) as Array<{ filename: string }>
  const tarball = join(repoRoot, packInfo[0]!.filename)

  mkdirSync(installRoot, { recursive: true })
  await runCommand(['npm', 'init', '-y'], installRoot)
  await runCommand(['npm', 'install', tarball], installRoot, {
    ...Bun.env,
    BGRUN_DB: testDbName,
    BGRUN_DISABLE_LEGACY_MIGRATION: '1',
  })

  const packageRoot = join(installRoot, 'node_modules', 'bgrun')
  expect(existsSync(join(packageRoot, 'dashboard', 'lib', 'runtime.ts'))).toBe(true)

  runtimeMod = await import(pathToFileURL(join(packageRoot, 'dashboard', 'lib', 'runtime.ts')).href)
  versionRoute = await import(pathToFileURL(join(packageRoot, 'dashboard', 'app', 'api', 'version', 'route.ts')).href)
  guardEventsRoute = await import(pathToFileURL(join(packageRoot, 'dashboard', 'app', 'api', 'guard-events', 'route.ts')).href)
  historyRoute = await import(pathToFileURL(join(packageRoot, 'dashboard', 'app', 'api', 'history', 'route.ts')).href)

  rmSync(tarball, { force: true })
})

afterAll(() => {
  try {
    if (runtimeMod?.db?.history) {
      const rows = runtimeMod.db.history.select().where({ process_name: 'packaged-history-proc' }).all() as Array<{ id: number }>
      for (const row of rows) runtimeMod.db.history.delete(row.id)
    }
  } catch {}

  try {
    if (runtimeMod?.dbPath) rmSync(runtimeMod.dbPath, { force: true })
  } catch {}

  delete process.env.BGRUN_DB
  delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION

  try {
    rmSync(tempRoot, { recursive: true, force: true })
  } catch {
    // Windows can briefly hold imported files open after the test process ends.
    // Cleanup is best-effort; the temp dir lives under OS temp storage.
  }
})

describe('installed package dashboard routes', () => {
  test('ships a working packaged dashboard runtime bridge', () => {
    expect(typeof runtimeMod.getVersion).toBe('function')
    expect(Array.isArray(runtimeMod.guardEvents)).toBe(true)
  })

  test('packaged version route resolves via installed runtime bridge', async () => {
    const res = await versionRoute.GET()
    const json = await res.json() as { version: string }
    expect(json.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('packaged guard-events route resolves via installed runtime bridge', async () => {
    const res = await guardEventsRoute.GET()
    const json = await res.json()
    expect(Array.isArray(json)).toBe(true)
  })

  test('packaged history route can write and read via installed DB runtime', async () => {
    const postReq = new Request('http://localhost/api/history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        process_name: 'packaged-history-proc',
        event: 'deploy',
        pid: 4242,
        metadata: { source: 'installed-package-test' },
      }),
    })
    const postRes = await historyRoute.POST(postReq)
    const postJson = await postRes.json() as { success: boolean }
    expect(postJson.success).toBe(true)

    const getReq = new Request('http://localhost/api/history?name=packaged-history-proc&event=deploy&format=json')
    const getRes = await historyRoute.GET(getReq)
    const rows = await getRes.json() as Array<{ process_name: string; event: string; pid: number; metadata: { source: string } }>

    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.process_name).toBe('packaged-history-proc')
    expect(rows[0]?.event).toBe('deploy')
    expect(rows[0]?.pid).toBe(4242)
    expect(rows[0]?.metadata?.source).toBe('installed-package-test')
  })
})
