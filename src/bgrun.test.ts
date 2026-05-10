/**
 * bgrun core utility tests
 *
 * Tests pure logic functions: env parsing, config flattening,
 * string truncation, and runtime calculation.
 *
 * Run: bun test src/bgrun.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { parseEnvString, parseCommandEnv, getDeclaredPort, calculateRuntime, buildManagedProcessEnv, getWatcherProcessName } from './utils'
import { parseConfigFile, loadConfigEnv } from './config'
import { buildDateProcessName, joinCommandArgs } from './cli-helpers'
import { stripAnsi, truncateString, truncatePath } from './table'
import { detectPackageManager, formatDeployToolError } from './deploy'
import { isProcessRunning, parseUnixListeningPorts, terminateProcess, waitForPortFree } from './platform'
import { mkdirSync, rmSync } from 'fs'

// Use a test-specific database to avoid polluting real data
process.env.BGRUN_DB = `bgrun-test-${Date.now()}.sqlite`
process.env.BGRUN_DISABLE_LEGACY_MIGRATION = '1'

async function rmDirWithRetries(dir: string, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            rmSync(dir, { recursive: true, force: true })
            return
        } catch (err: any) {
            if (err?.code !== 'EBUSY' || i === retries - 1) throw err
            await Bun.sleep(300)
        }
    }
}

const { handleRun, resolveInternalBgrunCommand } = await import('./commands/run')
const { handleGuardToggle } = await import('./commands/guard')
const { parseEnvitArgs, renderEnvitOutput } = await import('./commands/envit')
const { parseInlineArgs } = await import('./commands/inline')
const {
    getProcess,
    removeProcessByName,
    addDependency,
    removeDependency,
    getDependencyGraph,
    getDependencies,
    getDependents,
    getStartOrder,
    removeAllDependencies,
} = await import('./db')

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

describe('parseCommandEnv / getDeclaredPort', () => {
    test('parses Windows inline set prefixes', () => {
        expect(parseCommandEnv('set BUN_PORT=3105&& set DEBUG=true && bun run server.ts')).toEqual({
            BUN_PORT: '3105',
            DEBUG: 'true',
        })
    })

    test('parses Unix-style env prefixes', () => {
        expect(parseCommandEnv('PORT=4321 HOST=127.0.0.1 bun run server.ts')).toEqual({
            PORT: '4321',
            HOST: '127.0.0.1',
        })
    })

    test('prefers explicit process env over inline command env for declared port', () => {
        expect(getDeclaredPort({ PORT: '9999' }, 'set BUN_PORT=3105&& bun run server.ts')).toBe(9999)
    })

    test('detects declared port from inline command env', () => {
        expect(getDeclaredPort({}, 'set BUN_PORT=3105&& bun run server.ts')).toBe(3105)
    })
})

describe('buildManagedProcessEnv', () => {
    test('strips bgrun internal env leakage but preserves explicit process env', () => {
        const env = buildManagedProcessEnv(
            {
                PATH: '/bin',
                HOME: '/tmp/home',
                BUN_PORT: '3000',
                BGR_STDOUT: '/tmp/out.log',
                BGR_STDERR: '/tmp/err.log',
            },
            {
                PORT: '4310',
                CUSTOM_FLAG: 'true',
            },
        )

        expect(env.PATH).toBe(`${require('path').dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}/bin`)
        expect(env.HOME).toBe('/tmp/home')
        expect(env.PORT).toBe('4310')
        expect(env.CUSTOM_FLAG).toBe('true')
        expect(env.BUN_PORT).toBeUndefined()
        expect(env.BGR_STDOUT).toBeUndefined()
        expect(env.BGR_STDERR).toBeUndefined()
    })

    test('prioritizes the real bun executable directory on PATH', () => {
        const inheritedPath = [
            'C:\\project\\node_modules\\.bin',
            'C:\\Users\\galaxywin\\.bun\\bin',
            'C:\\Windows\\System32',
        ].join(process.platform === 'win32' ? ';' : ':')

        const env = buildManagedProcessEnv(
            {
                PATH: inheritedPath,
            },
            {},
        )

        const parts = (env.PATH || '').split(process.platform === 'win32' ? ';' : ':')
        expect(parts[0]).toBe(require('path').dirname(process.execPath))
        expect(parts.filter(part => part === require('path').dirname(process.execPath)).length).toBe(1)
        expect(parts).toContain('C:\\project\\node_modules\\.bin')
    })
})

describe('config env loading', () => {
    test('loads and flattens nested config sections', async () => {
        const dir = `${process.cwd()}/tmp-config-load-${Date.now()}`
        mkdirSync(dir, { recursive: true })

        try {
            await Bun.write(`${dir}/.config.toml`, [
                '[server]',
                'port = 3000',
                'host = "127.0.0.1"',
                '',
                '[wallets]',
                '0 = "abc"',
            ].join('\n'))

            const parsed = await parseConfigFile(`${dir}/.config.toml`)
            expect(parsed).toEqual({
                SERVER_PORT: '3000',
                SERVER_HOST: '127.0.0.1',
                WALLETS_0: 'abc',
            })

            const loaded = await loadConfigEnv(dir)
            expect(loaded.exists).toBe(true)
            expect(loaded.configEnv.SERVER_PORT).toBe('3000')
            expect(loaded.configEnv.SERVER_HOST).toBe('127.0.0.1')
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('returns empty env when config file is missing', async () => {
        const dir = `${process.cwd()}/tmp-config-missing-${Date.now()}`
        mkdirSync(dir, { recursive: true })

        try {
            const loaded = await loadConfigEnv(dir)
            expect(loaded.exists).toBe(false)
            expect(loaded.configEnv).toEqual({})
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('parseEnvitArgs', () => {
    test('parses positional config path', () => {
        expect(parseEnvitArgs([
            '.dev.toml',
        ])).toEqual({
            configPath: '.dev.toml',
            directory: undefined,
            shell: undefined,
            help: false,
        })
    })

    test('parses explicit shell and directory options', () => {
        expect(parseEnvitArgs([
            '--directory=apps/api',
            '--shell=json',
            '--config', '.env.toml',
        ])).toEqual({
            directory: 'apps/api',
            configPath: '.env.toml',
            shell: 'json',
            help: false,
        })
    })
})

describe('CLI --env mode', () => {
    test('prints PowerShell export lines from config', async () => {
        const dir = `${process.cwd()}/tmp-cli-env-${Date.now()}`
        mkdirSync(dir, { recursive: true })

        try {
            await Bun.write(`${dir}/.config.toml`, [
                '[server]',
                'port = 3000',
                'name = "demo"',
            ].join('\n'))

            const proc = Bun.spawn(
                ['bun', 'run', 'src/index.ts', '--env', '--directory', dir],
                {
                    cwd: process.cwd(),
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: Bun.env,
                }
            )

            const stdout = await new Response(proc.stdout).text()
            const stderr = await new Response(proc.stderr).text()
            const exitCode = await proc.exited

            expect(exitCode).toBe(0)
            expect(stderr).toBe('')
            expect(stdout).toContain("$env:SERVER_PORT='3000'")
            expect(stdout).toContain("$env:SERVER_NAME='demo'")
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('parseInlineArgs', () => {
    test('parses options before a -- command separator', () => {
        expect(parseInlineArgs([
            '--directory', 'apps/api',
            '--config=.dev.toml',
            '--',
            'bun', 'run', 'dev', '--watch',
        ])).toEqual({
            directory: 'apps/api',
            configPath: '.dev.toml',
            commandArgs: ['bun', 'run', 'dev', '--watch'],
            help: false,
        })
    })
})

describe('renderEnvitOutput', () => {
    test('renders PowerShell env assignments', () => {
        expect(renderEnvitOutput({ SERVER_PORT: '3000', NAME: "o'hare" }, 'powershell')).toBe([
            "$env:SERVER_PORT='3000'",
            "$env:NAME='o''hare'",
        ].join('\n'))
    })

    test('renders POSIX export statements', () => {
        expect(renderEnvitOutput({ SERVER_PORT: '3000' }, 'sh')).toBe("export SERVER_PORT='3000'")
    })
})

describe('cli helpers', () => {
    test('builds date-based process names', () => {
        expect(buildDateProcessName(new Date(2026, 3, 5, 12, 0, 0))).toBe('april-fifth')
    })

    test('quotes command args for shell reconstruction', () => {
        expect(joinCommandArgs(['bun', 'run', 'my script.ts'])).toContain('my')
        expect(joinCommandArgs(['bun', 'run', 'my script.ts'])).not.toBe('bun run my script.ts')
    })

    test('does not quote a plain Windows absolute path argument', () => {
        const command = joinCommandArgs(['bun', 'run', 'C:\\Code\\melina.js\\examples\\port-check\\server-implicit.ts'])
        if (process.platform === 'win32') {
            expect(command).toBe('bun run C:\\Code\\melina.js\\examples\\port-check\\server-implicit.ts')
        } else {
            expect(command).toContain('server-implicit.ts')
        }
    })
})

describe('resolveInternalBgrunCommand', () => {
    test('rewrites legacy internal dashboard command to bunx bgrun', () => {
        const resolved = resolveInternalBgrunCommand('bgrun --_serve')
        expect(resolved).toBe('bunx bgrun --_serve')
        expect(resolved).toContain('--_serve')
    })

    test('rewrites legacy internal watcher command to bunx bgrun', () => {
        const resolved = resolveInternalBgrunCommand('bgrun --_watch-process "my-app"')
        expect(resolved).toBe('bunx bgrun --_watch-process "my-app"')
        expect(resolved).toContain('--_watch-process')
        expect(resolved).toContain('my-app')
    })

    test('leaves bunx internal commands unchanged', () => {
        expect(resolveInternalBgrunCommand('bunx bgrun --_serve')).toBe('bunx bgrun --_serve')
    })

    test('leaves normal commands unchanged', () => {
        expect(resolveInternalBgrunCommand('bun run server.ts')).toBe('bun run server.ts')
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

describe('handleRun port safety', () => {
    test('does not auto-enable guard for new processes', async () => {
        const dir = `${process.cwd()}/tmp-no-guard-default-${Date.now()}`
        const scriptPath = `${dir}/worker.ts`
        const name = `no-guard-default-${Date.now()}`

        mkdirSync(dir, { recursive: true })
        await Bun.write(scriptPath, 'setInterval(() => {}, 1000);\n')

        try {
            await handleRun({
                action: 'run',
                name,
                directory: dir,
                command: `bun run ${scriptPath}`,
                remoteName: '',
            })

            const proc = getProcess(name)
            expect(proc).toBeDefined()
            const env = proc?.env ?? ''
            expect(env).not.toContain('BGR_KEEP_ALIVE=true')
        } finally {
            const proc = getProcess(name)
            if (proc) {
                try {
                    await terminateProcess(proc.pid, true)
                } catch { }
                removeProcessByName(name)
            }
            rmSync(dir, { recursive: true, force: true })
        }
    }, 15000)

    test('does not refuse startup solely because PORT is set when the script ignores it', async () => {
        const dir = `${process.cwd()}/tmp-port-guard-${Date.now()}`
        const scriptPath = `${dir}/ignore-port.ts`
        const name = `ignore-port-${Date.now()}`
        const probe = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch() { return new Response('ok') },
        })
        const port = probe.port
        probe.stop(true)

        mkdirSync(dir, { recursive: true })
        await Bun.write(scriptPath, [
            'setInterval(() => {}, 1000);',
        ].join('\n'))

        try {
            await handleRun({
                action: 'run',
                name,
                directory: dir,
                command: `bun run ${scriptPath}`,
                env: { PORT: String(port), BGR_KEEP_ALIVE: 'false' },
                remoteName: '',
            })

            const proc = getProcess(name)
            expect(proc).toBeDefined()
            expect(proc?.pid ?? 0).toBeGreaterThan(0)
        } finally {
            const proc = getProcess(name)
            if (proc) {
                try {
                    await terminateProcess(proc.pid, true)
                } catch { }
                removeProcessByName(name)
            }
            probe.stop(true)
            await waitForPortFree(port, 5000)
            rmSync(dir, { recursive: true, force: true })
        }
    }, 15000)

    test('still cleans up the old process ports on force restart', async () => {
        const dir = `${process.cwd()}/tmp-port-guard-${Date.now()}`
        const scriptPath = `${dir}/serve-port.ts`
        const name = `port-guard-a-${Date.now()}`
        const probe = Bun.serve({
            port: 0,
            hostname: '127.0.0.1',
            fetch() { return new Response('ok') },
        })
        const port = probe.port
        probe.stop(true)

        mkdirSync(dir, { recursive: true })
        await Bun.write(scriptPath, [
            'const port = Number(process.env.PORT);',
            'Bun.serve({ port, hostname: "127.0.0.1", fetch() { return new Response("ok"); } });',
            'setInterval(() => {}, 1000);',
        ].join('\n'))

        try {
            await handleRun({
                action: 'run',
                name,
                directory: dir,
                command: `bun run ${scriptPath}`,
                env: { PORT: String(port), BGR_KEEP_ALIVE: 'false' },
                remoteName: '',
            })

            await Bun.sleep(800)

            await handleRun({
                action: 'run',
                name,
                directory: dir,
                command: `bun run ${scriptPath}`,
                env: { PORT: String(port), BGR_KEEP_ALIVE: 'false' },
                remoteName: '',
                force: true,
            })

            const proc = getProcess(name)
            expect(proc).toBeDefined()
            expect(proc?.pid ?? 0).toBeGreaterThan(0)
        } finally {
            const proc = getProcess(name)
            if (proc) {
                try {
                    await terminateProcess(proc.pid, true)
                } catch { }
                removeProcessByName(name)
            }
            await waitForPortFree(port, 5000)
            rmSync(dir, { recursive: true, force: true })
        }
    }, 20000)
})

describe('CLI implicit command mode', () => {
    test('treats multi-positional args as a managed command without requiring literal --', async () => {
        const dir = `${process.cwd()}/tmp-cli-implicit-${Date.now()}`
        const scriptPath = `${dir}/worker.ts`

        mkdirSync(dir, { recursive: true })
        await Bun.write(scriptPath, 'setInterval(() => {}, 1000);\n')

        let launchedName = ''

        try {
            const proc = Bun.spawn(
                ['bun', 'run', 'src/index.ts', '--directory', dir, 'bun', 'run', scriptPath],
                {
                    cwd: process.cwd(),
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: {
                        ...Bun.env,
                        BGRUN_DB: process.env.BGRUN_DB!,
                        BGRUN_DISABLE_LEGACY_MIGRATION: '1',
                    },
                }
            )

            const stdout = await new Response(proc.stdout).text()
            const stderr = await new Response(proc.stderr).text()
            const exitCode = await proc.exited

            expect(exitCode).toBe(0)
            expect(stderr).toBe('')
            expect(stdout).toContain('Launched process "')

            const match = stdout.match(/Launched process "([^"]+)"/)
            expect(match).not.toBeNull()
            launchedName = match?.[1] || ''
            expect(launchedName.length).toBeGreaterThan(0)
        } finally {
            if (launchedName) {
                const proc = getProcess(launchedName)
                if (proc) {
                    try {
                        await terminateProcess(proc.pid, true)
                    } catch { }
                    removeProcessByName(launchedName)
                }
            }
            await rmDirWithRetries(dir)
        }
    }, 20000)
})

describe('guard CLI toggles', () => {
    test('enables and disables the per-process watcher', async () => {
        const dir = `${process.cwd()}/tmp-guard-toggle-${Date.now()}`
        const scriptPath = `${dir}/worker.ts`
        const name = `guard-toggle-${Date.now()}`
        const watcherName = getWatcherProcessName(name)

        mkdirSync(dir, { recursive: true })
        await Bun.write(scriptPath, 'setInterval(() => {}, 1000);\n')

        try {
            await handleRun({
                action: 'run',
                name,
                directory: dir,
                command: `bun run ${scriptPath}`,
                remoteName: '',
            })

            let proc = getProcess(name)
            expect(proc).toBeDefined()
            expect(proc?.env ?? '').not.toContain('BGR_KEEP_ALIVE=true')

            await handleGuardToggle(name, true)

            await Bun.sleep(1200)

            proc = getProcess(name)
            expect(proc).toBeDefined()
            expect(proc?.env ?? '').toContain('BGR_KEEP_ALIVE=true')
            expect(getProcess(watcherName)).toBeDefined()

            await handleGuardToggle(name, false)

            await Bun.sleep(600)

            proc = getProcess(name)
            expect(proc).toBeDefined()
            expect(proc?.env ?? '').not.toContain('BGR_KEEP_ALIVE=true')
            expect(getProcess(watcherName)).toBeNull()
        } finally {
            const watcherProc = getProcess(watcherName)
            if (watcherProc) {
                try {
                    await terminateProcess(watcherProc.pid, true)
                } catch { }
                removeProcessByName(watcherName)
            }

            const proc = getProcess(name)
            if (proc) {
                try {
                    await terminateProcess(proc.pid, true)
                } catch { }
                removeProcessByName(name)
            }

            await rmDirWithRetries(dir)
        }
    }, 25000)
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
