/**
 * bgrun core utility tests
 *
 * Tests pure logic functions: env parsing, config flattening,
 * string truncation, and runtime calculation.
 *
 * Run: bun test src/bgrun.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { parseEnvString, calculateRuntime } from './utils'
import { stripAnsi, truncateString, truncatePath } from './table'
import { detectPackageManager } from './deploy'
import { mkdirSync, rmSync } from 'fs'

// ─── parseEnvString ─────────────────────────────────────

describe('parseEnvString', () => {
    test('parses comma-separated key=value pairs', () => {
        const result = parseEnvString('PORT=3000,HOST=localhost,DEBUG=true')
        expect(result).toEqual({
            PORT: '3000',
            HOST: 'localhost',
            DEBUG: 'true',
        })
    })

    test('handles single pair', () => {
        expect(parseEnvString('KEY=value')).toEqual({ KEY: 'value' })
    })

    test('handles empty string', () => {
        expect(parseEnvString('')).toEqual({})
    })

    test('ignores malformed pairs (no =)', () => {
        const result = parseEnvString('GOOD=yes,BAD,ALSO_GOOD=ok')
        expect(result.GOOD).toBe('yes')
        expect(result.ALSO_GOOD).toBe('ok')
        expect(result.BAD).toBeUndefined()
    })
})

// ─── calculateRuntime ───────────────────────────────────

describe('calculateRuntime', () => {
    test('returns 0 minutes for recent start', () => {
        const now = new Date().toISOString()
        expect(calculateRuntime(now)).toBe('0 minutes')
    })

    test('returns correct minutes', () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        expect(calculateRuntime(fiveMinAgo)).toBe('5 minutes')
    })

    test('returns correct for 1 hour', () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        expect(calculateRuntime(oneHourAgo)).toBe('60 minutes')
    })
})

// ─── stripAnsi ──────────────────────────────────────────

describe('stripAnsi', () => {
    test('strips color codes', () => {
        const colored = '\u001b[31mred text\u001b[0m'
        expect(stripAnsi(colored)).toBe('red text')
    })

    test('passes through plain text', () => {
        expect(stripAnsi('hello world')).toBe('hello world')
    })

    test('handles empty string', () => {
        expect(stripAnsi('')).toBe('')
    })
})

// ─── truncateString ─────────────────────────────────────

describe('truncateString', () => {
    test('returns string unchanged if within limit', () => {
        expect(truncateString('hello', 10)).toBe('hello')
    })

    test('truncates with ellipsis', () => {
        const result = truncateString('a very long string that exceeds limit', 15)
        expect(result.length).toBeLessThanOrEqual(15)
        expect(result).toContain('…')
    })

    test('handles maxLength smaller than ellipsis', () => {
        const result = truncateString('hello world', 2)
        expect(result.length).toBeLessThanOrEqual(2)
    })
})

// ─── truncatePath ───────────────────────────────────────

describe('truncatePath', () => {
    test('returns path unchanged if within limit', () => {
        expect(truncatePath('/home/user', 50)).toBe('/home/user')
    })

    test('truncates middle of long path', () => {
        const longPath = '/home/user/projects/very/deeply/nested/directory/structure'
        const result = truncatePath(longPath, 30)
        expect(result.length).toBeLessThanOrEqual(30)
        expect(result).toContain('…')
    })
})

// ─── detectPackageManager ───────────────────────────────

describe('detectPackageManager', () => {
    test('returns null when no package.json exists', async () => {
        const dir = `${process.cwd()}/tmp-no-package-${Date.now()}`
        mkdirSync(dir, { recursive: true })
        try {
            expect(await detectPackageManager(dir)).toBeNull()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('prefers bun lockfiles', async () => {
        const dir = `${process.cwd()}/tmp-bun-${Date.now()}`
        mkdirSync(dir, { recursive: true })
        try {
            await Bun.write(`${dir}/package.json`, '{}')
            await Bun.write(`${dir}/bun.lock`, '')
            expect(await detectPackageManager(dir)).toBe('bun')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('detects pnpm, yarn, and npm lockfiles', async () => {
        const base = `${process.cwd()}/tmp-pm-${Date.now()}`

        const pnpmDir = `${base}-pnpm`
        mkdirSync(pnpmDir, { recursive: true })
        await Bun.write(`${pnpmDir}/package.json`, '{}')
        await Bun.write(`${pnpmDir}/pnpm-lock.yaml`, '')
        expect(await detectPackageManager(pnpmDir)).toBe('pnpm')

        const yarnDir = `${base}-yarn`
        mkdirSync(yarnDir, { recursive: true })
        await Bun.write(`${yarnDir}/package.json`, '{}')
        await Bun.write(`${yarnDir}/yarn.lock`, '')
        expect(await detectPackageManager(yarnDir)).toBe('yarn')

        const npmDir = `${base}-npm`
        mkdirSync(npmDir, { recursive: true })
        await Bun.write(`${npmDir}/package.json`, '{}')
        await Bun.write(`${npmDir}/package-lock.json`, '{}')
        expect(await detectPackageManager(npmDir)).toBe('npm')

        rmSync(pnpmDir, { recursive: true, force: true })
        rmSync(yarnDir, { recursive: true, force: true })
        rmSync(npmDir, { recursive: true, force: true })
    })

    test('defaults to bun for package.json projects without a lockfile', async () => {
        const dir = `${process.cwd()}/tmp-default-bun-${Date.now()}`
        mkdirSync(dir, { recursive: true })
        try {
            await Bun.write(`${dir}/package.json`, '{}')
            expect(await detectPackageManager(dir)).toBe('bun')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
