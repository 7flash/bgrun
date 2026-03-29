import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

const testDbName = `bgrun-dist-api-${Date.now()}.sqlite`
process.env.BGRUN_DB = testDbName
process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'

const homePath = process.env.USERPROFILE || process.env.HOME || ''
const testDbPath = join(homePath, '.bgr', testDbName)

let srcApi: any
let distApi: any

async function importFresh(path: string) {
  return await import(`${path}?case=${Date.now()}-${Math.random()}`)
}

beforeAll(async () => {
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  })
  const exitCode = await build.exited
  const stderr = await new Response(build.stderr).text()
  if (exitCode !== 0) {
    throw new Error(`build failed: ${stderr}`)
  }

  srcApi = await importFresh('../src/api.ts')
  distApi = await importFresh('../dist/api.js')
})

afterAll(() => {
  try { rmSync(testDbPath, { force: true }) } catch {}
  delete process.env.BGRUN_DB
  delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION
})

describe('dist/api.js compatibility', () => {
  test('build emits dist/api.js', () => {
    expect(existsSync(join(import.meta.dir, '..', 'dist', 'api.js'))).toBe(true)
  })

  test('matches named export surface from src/api.ts', () => {
    const srcKeys = Object.keys(srcApi).sort()
    const distKeys = Object.keys(distApi).sort()
    expect(distKeys).toEqual(srcKeys)
  })

  test('matches default export namespace keys', () => {
    const srcKeys = Object.keys(srcApi.default).sort()
    const distKeys = Object.keys(distApi.default).sort()
    expect(distKeys).toEqual(srcKeys)
  })

  test('preserves core utility behavior', () => {
    expect(distApi.parseEnvString('PORT=3000,DEBUG=true')).toEqual(srcApi.parseEnvString('PORT=3000,DEBUG=true'))
    expect(distApi.calculateRuntime('2026-03-29T00:00:00.000Z')).toBe(srcApi.calculateRuntime('2026-03-29T00:00:00.000Z'))
    expect(distApi.isWindows()).toBe(srcApi.isWindows())
  })

  test('exposes the same database path metadata', () => {
    expect(distApi.dbPath).toBe(srcApi.dbPath)
    expect(distApi.bgrHome).toBe(srcApi.bgrHome)
  })
})
