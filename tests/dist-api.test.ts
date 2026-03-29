import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { join } from 'path'

const repoRoot = join(import.meta.dir, '..')

async function runModuleProbe(modulePath: string, expression: string) {
  const proc = Bun.spawn([
    'bun',
    '--eval',
    `const mod = await import(${JSON.stringify(modulePath)}); const value = (${expression}); console.log(JSON.stringify(value));`,
  ], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...Bun.env,
      BGRUN_DB: `bgrun-dist-api-probe-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`,
      BGRUN_DISABLE_LEGACY_MIGRATION: '1',
    },
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  if (exitCode !== 0) {
    throw new Error(`probe failed for ${modulePath}: ${stderr || stdout}`)
  }
  return JSON.parse(stdout.trim())
}

beforeAll(async () => {
  const build = Bun.spawn(['bun', 'run', 'build'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: Bun.env,
  })
  const exitCode = await build.exited
  const stderr = await new Response(build.stderr).text()
  if (exitCode !== 0) {
    throw new Error(`build failed: ${stderr}`)
  }
})

describe('dist/api.js compatibility', () => {
  test('build emits dist/api.js', () => {
    expect(existsSync(join(repoRoot, 'dist', 'api.js'))).toBe(true)
  })

  test('matches named export surface from src/api.ts', async () => {
    const srcKeys = await runModuleProbe('./src/api.ts', 'Object.keys(mod).sort()')
    const distKeys = await runModuleProbe('./dist/api.js', 'Object.keys(mod).sort()')
    expect(distKeys).toEqual(srcKeys)
  })

  test('matches default export namespace keys', async () => {
    const srcKeys = await runModuleProbe('./src/api.ts', 'Object.keys(mod.default).sort()')
    const distKeys = await runModuleProbe('./dist/api.js', 'Object.keys(mod.default).sort()')
    expect(distKeys).toEqual(srcKeys)
  })

  test('preserves core utility behavior', async () => {
    const srcValue = await runModuleProbe('./src/api.ts', '({ env: mod.parseEnvString("PORT=3000,DEBUG=true"), runtime: mod.calculateRuntime("2026-03-29T00:00:00.000Z"), isWindows: mod.isWindows() })')
    const distValue = await runModuleProbe('./dist/api.js', '({ env: mod.parseEnvString("PORT=3000,DEBUG=true"), runtime: mod.calculateRuntime("2026-03-29T00:00:00.000Z"), isWindows: mod.isWindows() })')
    expect(distValue).toEqual(srcValue)
  })

  test('exposes the same database path metadata shape', async () => {
    const srcValue = await runModuleProbe('./src/api.ts', '({ dbPath: mod.dbPath, bgrHome: mod.bgrHome })')
    const distValue = await runModuleProbe('./dist/api.js', '({ dbPath: mod.dbPath, bgrHome: mod.bgrHome })')
    expect(typeof distValue.dbPath).toBe('string')
    expect(typeof distValue.bgrHome).toBe('string')
    expect(distValue.dbPath.endsWith('.sqlite')).toBe(true)
    expect(distValue.bgrHome).toBe(srcValue.bgrHome)
  })
})
