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
import { detectPackageManager, formatDeployToolError } from './deploy'
import { isProcessRunning, parseUnixListeningPorts } from './platform'
import { mkdirSync, rmSync } from 'fs'

// Use a test-specific database to avoid polluting real data
process.env.BGRUN_DB = `bgrun-test-${Date.now()}.sqlite`
process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'
import { addDependency, removeDependency, getDependencyGraph, getDependencies, getDependents, getStartOrder, removeAllDependencies } from './db'

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

// ─── isProcessRunning (Windows liveness fallback) ───────

describe('isProcessRunning', () => {
    test('returns true for the current process PID', async () => {
        const alive = await isProcessRunning(process.pid)
        expect(alive).toBe(true)
    })

    test('returns false for PID 0 (intentionally stopped)', async () => {
        const alive = await isProcessRunning(0)
        expect(alive).toBe(false)
    })

    test('returns false for a very high unlikely PID', async () => {
        const alive = await isProcessRunning(999999)
        expect(alive).toBe(false)
    })

    test('returns false for negative PID', async () => {
        const alive = await isProcessRunning(-1)
        expect(alive).toBe(false)
    })
})

describe('parseUnixListeningPorts', () => {
    test('extracts only LISTEN ports from lsof output', () => {
        const output = [
            'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
            'bun     12345 root   21u  IPv4 123456      0t0  TCP *:3400 (LISTEN)',
            'bun     12345 root   22u  IPv4 123457      0t0  TCP 127.0.0.1:9222 (LISTEN)',
        ].join('\n')

        expect(parseUnixListeningPorts(output)).toEqual([3400, 9222])
    })

    test('ignores non-LISTEN sockets from broad lsof output', () => {
        const output = [
            'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
            'bun     12345 root   18u  IPv4 111111      0t0  TCP 127.0.0.1:49440->127.0.0.1:3000 (ESTABLISHED)',
            'bun     12345 root   19u  IPv4 111112      0t0  TCP 127.0.0.1:49441->127.0.0.1:3737 (ESTABLISHED)',
            'bun     12345 root   20u  IPv4 111113      0t0  TCP *:3400 (LISTEN)',
        ].join('\n')

        expect(parseUnixListeningPorts(output)).toEqual([3400])
    })

    test('returns empty array for no-port worker output', () => {
        const output = [
            'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
            'bun     12345 root   18u  unix 0xffff      0t0      /tmp/bun.sock',
            'bun     12345 root   19u  IPv4 111111      0t0  TCP 127.0.0.1:49440->127.0.0.1:3000 (ESTABLISHED)',
        ].join('\n')

        expect(parseUnixListeningPorts(output)).toEqual([])
    })
})

// ─── detectPackageManager ───────────────────────────────

describe('formatDeployToolError', () => {
    test('returns actionable message for missing binary', () => {
        const msg = formatDeployToolError('pnpm', new Error('command not found: pnpm'))
        expect(msg).toContain("requires 'pnpm'")
        expect(msg).toContain('PATH')
    })

    test('preserves non-missing-binary failures', () => {
        const msg = formatDeployToolError('npm', new Error('npm ci failed with exit code 1'))
        expect(msg).toContain('Dependency install failed with npm')
        expect(msg).toContain('exit code 1')
    })
})

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

// ─── Dependencies ───────────────────────────────────────

describe('addDependency', () => {
    test('adds a valid dependency', () => {
        removeAllDependencies('web-server');
        removeAllDependencies('database');
        const ok = addDependency('web-server', 'database');
        expect(ok).toBe(true);
        expect(getDependencies('web-server')).toContain('database');
    })

    test('prevents self-dependency', () => {
        expect(addDependency('api', 'api')).toBe(false);
    })

    test('prevents duplicate dependency', () => {
        removeAllDependencies('app');
        addDependency('app', 'db');
        expect(addDependency('app', 'db')).toBe(false);
    })

    test('prevents circular dependency', () => {
        removeAllDependencies('a');
        removeAllDependencies('b');
        removeAllDependencies('c');
        addDependency('a', 'b');
        addDependency('b', 'c');
        // c -> a would create a cycle
        expect(addDependency('c', 'a')).toBe(false);
    })
})

describe('getDependencyGraph', () => {
    test('returns full graph', () => {
        removeAllDependencies('svc-a');
        removeAllDependencies('svc-b');
        addDependency('svc-a', 'svc-b');
        const graph = getDependencyGraph();
        expect(graph['svc-a']).toContain('svc-b');
    })
})

describe('getDependents', () => {
    test('finds processes that depend on a target', () => {
        removeAllDependencies('frontend');
        removeAllDependencies('backend');
        addDependency('frontend', 'backend');
        expect(getDependents('backend')).toContain('frontend');
    })
})

describe('removeDependency', () => {
    test('removes an existing dependency', () => {
        removeAllDependencies('x');
        addDependency('x', 'y');
        expect(getDependencies('x')).toContain('y');
        removeDependency('x', 'y');
        expect(getDependencies('x')).not.toContain('y');
    })
})
