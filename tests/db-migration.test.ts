import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const homePath = process.env.USERPROFILE || process.env.HOME || ''
const bgrDir = join(homePath, '.bgr')
const legacyDbPath = join(bgrDir, 'bgr_v2.sqlite')
const backupLegacyDbPath = join(bgrDir, `bgr_v2.backup-${Date.now()}.sqlite`)
const createdTestDbPaths: string[] = []

let hadLegacyDb = false

async function importFreshDbModule(options?: { silenceLogs?: boolean }) {
  const suffix = `${Date.now()}-${Math.random()}`
  if (!options?.silenceLogs) {
    return await import(`../src/db.ts?case=${suffix}`)
  }

  const originalLog = console.log
  console.log = () => {}
  try {
    return await import(`../src/db.ts?case=${suffix}`)
  } finally {
    console.log = originalLog
  }
}

function setFreshTestDbName() {
  const testDbName = `bgrun-migration-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`
  const testDbPath = join(bgrDir, testDbName)
  process.env.BGRUN_DB = testDbName
  createdTestDbPaths.push(testDbPath)
  return testDbPath
}

beforeEach(() => {
  rmSync(backupLegacyDbPath, { force: true })
  mkdirSync(bgrDir, { recursive: true })
  if (existsSync(legacyDbPath)) {
    copyFileSync(legacyDbPath, backupLegacyDbPath)
    hadLegacyDb = true
    rmSync(legacyDbPath, { force: true })
  } else {
    hadLegacyDb = false
  }
  const legacyDb = new Database(legacyDbPath)
  legacyDb.exec(`CREATE TABLE IF NOT EXISTS legacy_marker (value TEXT); INSERT INTO legacy_marker (value) VALUES ('legacy');`)
  legacyDb.close()
})

afterAll(() => {
  for (const testDbPath of createdTestDbPaths) {
    try { rmSync(testDbPath, { force: true }) } catch {}
  }
  try { rmSync(legacyDbPath, { force: true }) } catch {}
  if (hadLegacyDb && existsSync(backupLegacyDbPath)) {
    copyFileSync(backupLegacyDbPath, legacyDbPath)
  }
  try { rmSync(backupLegacyDbPath, { force: true }) } catch {}
  delete process.env.BGRUN_DB
  delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION
})

describe('legacy DB migration guard', () => {
  test('skips legacy copy when BGRUN_DISABLE_LEGACY_MIGRATION=1', async () => {
    const testDbPath = setFreshTestDbName()
    process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'
    await importFreshDbModule()
    expect(existsSync(testDbPath)).toBe(true)
    const db = new Database(testDbPath)
    const marker = db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_marker'`).get() as { name: string } | null
    db.close()
    expect(marker).toBeNull()
  })

  test('still migrates legacy DB by default', async () => {
    const testDbPath = setFreshTestDbName()
    delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION
    await importFreshDbModule({ silenceLogs: true })
    expect(existsSync(testDbPath)).toBe(true)
    const db = new Database(testDbPath)
    const marker = db.query(`SELECT value FROM legacy_marker LIMIT 1`).get() as { value: string } | null
    db.close()
    expect(marker?.value).toBe('legacy')
  })
})
