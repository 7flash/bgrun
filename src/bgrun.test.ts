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
