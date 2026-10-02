import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(projectRoot, 'package.json'));
const compiled = new Map();
export function sqliteAdapter(connections) {
    return class NodeSqliteAdapter {
        constructor(filename, options = {}) {
            this.connection = new DatabaseSync(filename, { readOnly: options.readonly ?? false });
            this.depth = 0;
            connections.push(this);
        }
        exec(sql) { this.connection.exec(sql); }
        run(sql, ...args) {
            if (args.length)
                return this.query(sql).run(...args);
            this.connection.exec(sql);
        }
        query(sql) {
            const statement = this.connection.prepare(sql);
            return {
                get: (...args) => statement.get(...args),
                all: (...args) => statement.all(...args),
                run: (...args) => statement.run(...args),
                finalize() { },
            };
        }
        transaction(operation) {
            const invoke = (mode) => {
                const nested = this.depth > 0;
                const savepoint = `test_transaction_${this.depth}`;
                this.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${mode}`);
                this.depth++;
                try {
                    const result = operation();
                    if (result?.then)
                        throw new Error('SQLite transaction callbacks must be synchronous');
                    this.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
                    return result;
                }
                catch (error) {
                    this.exec(nested ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
                    if (nested)
                        this.exec(`RELEASE ${savepoint}`);
                    throw error;
                }
                finally {
                    this.depth--;
                }
            };
            const transaction = () => invoke('DEFERRED');
            transaction.immediate = () => invoke('IMMEDIATE');
            transaction.exclusive = () => invoke('EXCLUSIVE');
            transaction.deferred = transaction;
            return transaction;
        }
        close() { if (this.connection.isOpen)
            this.connection.close(); }
    };
}
export function createSourceLoader({ overrides = new Map(), packages = {}, globals = {} } = {}) {
    const modules = new Map();
    const context = vm.createContext({
        process, Buffer, console, Date, Error, AggregateError, TypeError, RangeError,
        URL, Response, Request, TextEncoder, TextDecoder, performance,
        setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, ...globals,
    });
    function load(filename) {
        filename = path.resolve(projectRoot, filename);
        if (overrides.has(filename))
            return overrides.get(filename);
        if (modules.has(filename))
            return modules.get(filename).exports;
        if (!compiled.has(filename)) {
            const source = fs.readFileSync(filename, 'utf8');
            const result = ts.transpileModule(source, {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
                transformers: { before: [(ctx) => {
                            const visit = (node) => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
                                ? ctx.factory.createIdentifier('__testImportMeta') : ts.visitEachChild(node, visit, ctx);
                            return (node) => ts.visitNode(node, visit);
                        }] },
            });
            compiled.set(filename, result.outputText);
        }
        const module = { exports: {} };
        modules.set(filename, module);
        const localRequire = (specifier) => {
            if (Object.hasOwn(packages, specifier))
                return packages[specifier];
            if (specifier === 'sqlite-zod-orm')
                return load('node_modules/sqlite-zod-orm/src/index.ts');
            if (specifier.startsWith('.')) {
                const relative = path.resolve(path.dirname(filename), specifier);
                if (fs.existsSync(relative) && fs.statSync(relative).isFile())
                    return load(relative);
                if (fs.existsSync(`${relative}.ts`))
                    return load(`${relative}.ts`);
                throw new Error(`Unresolved source dependency ${filename}: ${specifier}`);
            }
            return require(specifier);
        };
        const evaluate = new vm.Script(`(function(exports, require, module, __testImportMeta) {\n${compiled.get(filename)}\n})`, { filename }).runInContext(context);
        evaluate(module.exports, localRequire, module, { dir: path.dirname(filename), path: filename, url: pathToFileURL(filename).href, main: false });
        return module.exports;
    }
    return { load, context };
}
export function createFixture(test, options = {}) {
    const root = fs.mkdtempSync(path.join(projectRoot, '.test-state-control-'));
    const connections = [];
    const trace = [];
    const controls = {
        children: new Map(), probes: new Map(), nextPid: 420000,
        missingBirth: false, failCleanup: false, failGuard: false,
        inspections: 0, spawnCalls: 0, cleanupCalls: 0, guardCalls: 0,
        beforeInspect: null, beforeSpawn: null, sleep: null, ...options.controls,
    };
    const currentProcess = {
        ...process, pid: process.pid, platform: process.platform, execPath: process.execPath,
        env: { BGRUN_HOME: root, BGRUN_DB: 'registry.sqlite', BGRUN_DISABLE_LEGACY_MIGRATION: '1', BGR_STARTUP_HEALTH_GRACE_MS: '0' },
        cwd: () => root,
    };
    const identity = {
        inspectPid(pid) {
            if (!Number.isSafeInteger(pid) || pid <= 0)
                return 'dead';
            if (pid === currentProcess.pid)
                return 'alive';
            if (controls.probes.has(pid))
                return controls.probes.get(pid);
            return controls.children.get(pid)?.alive ? 'alive' : 'dead';
        },
        getProcessBirthId(pid) {
            if (pid === currentProcess.pid)
                return 'manager-birth';
            if (controls.missingBirth)
                return '';
            return identity.inspectPid(pid) === 'alive' ? `birth-${pid}` : '';
        },
        isLivePid: (pid) => identity.inspectPid(pid) !== 'dead',
    };
    const platform = {
        getHomeDir: () => root,
        ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
        async inspectManagedProcess(pid, name, birth) {
            controls.inspections++;
            if (controls.beforeInspect) {
                const hook = controls.beforeInspect;
                controls.beforeInspect = null;
                return hook(pid, name, birth);
            }
            return identity.inspectPid(pid);
        },
        isManagedProcessRunning: async (pid, name, _command, birth) => await platform.inspectManagedProcess(pid, name, birth) === 'alive',
        isProcessRunning: async (pid) => identity.isLivePid(pid),
        terminateProcess: async (pid) => {
            controls.cleanupCalls++;
            if (controls.failCleanup)
                throw new Error('injected tree cleanup failure');
            const child = controls.children.get(pid);
            if (child)
                child.kill();
            else
                controls.probes.set(pid, 'dead');
        },
        getShellCommand: (command) => ['sh', '-c', command],
        getProcessMemory: async () => 0,
        getProcessBatchResources: async () => new Map(),
        resolvePidWithPorts: async (pid) => ({ pid, ports: [] }),
    };
    const watcherStub = {
        async syncProcessWatcher() { controls.guardCalls++; if (controls.failGuard)
            throw new Error('injected guard setup failure'); },
        async stopProcessWatcher() { },
    };
    const bun = {
        env: currentProcess.env,
        sleep: async () => { if (controls.sleep)
            await controls.sleep(); },
        spawn(args, options) {
            controls.beforeSpawn?.();
            controls.spawnCalls++;
            let confirmExit;
            const child = {
                pid: ++controls.nextPid, alive: true, unrefCalls: 0, killCalls: 0, args, options,
                exited: new Promise((resolve) => { confirmExit = resolve; }),
                kill() { this.killCalls++; this.alive = false; confirmExit(137); },
                unref() { this.unrefCalls++; },
            };
            controls.children.set(child.pid, child);
            return child;
        },
    };
    const overrides = new Map([
        [path.join(projectRoot, 'src/platform.ts'), platform],
        [path.join(projectRoot, 'src/process-identity.ts'), identity],
        [path.join(projectRoot, 'src/watcher.ts'), watcherStub],
        ...(options.overrides ?? []),
    ]);
    const packages = { 'bun:sqlite': { Database: sqliteAdapter(connections) }, ...(options.packages ?? {}) };
    const globals = { process: currentProcess, Bun: bun, console: {
            log: (...args) => trace.push(args.join(' ')), warn: (...args) => trace.push(args.join(' ')), error: (...args) => trace.push(args.join(' ')),
        } };
    const loader = createSourceLoader({ overrides, packages, globals });
    test.after(() => {
        for (const child of controls.children.values())
            child.kill();
        for (const connection of connections.reverse())
            connection.close();
        fs.rmSync(root, { recursive: true, force: true });
    });
    options.beforeLoad?.({ root, process: currentProcess });
    const db = loader.load('src/db.ts');
    const run = loader.load('src/commands/run.ts');
    const cleanup = loader.load('src/commands/cleanup.ts');
    const lifecycle = loader.load('src/lifecycle-state.ts');
    const locks = loader.load('src/operation-locks.ts');
    function seed(name = 'target', fields = {}) {
        return db.insertProcess({ name, pid: 210000, command: 'worker', workdir: root, configPath: '',
            env: JSON.stringify({ BGR_KEEP_ALIVE: 'true' }), stdout_path: path.join(root, `${name}-out.txt`), stderr_path: path.join(root, `${name}-err.txt`),
            start_identity: 'old-birth', ...fields });
    }
    function loadWatcher() {
        overrides.delete(path.join(projectRoot, 'src/watcher.ts'));
        return loader.load('src/watcher.ts');
    }
    return { root, connections, packages, globals, controls, trace, process: currentProcess, identity, platform, db, run, cleanup, lifecycle, locks, loader, seed, loadWatcher, watcherStub,
        launch: { name: 'target', command: 'worker', directory: root, configPath: '', env: { BGR_KEEP_ALIVE: 'true' } } };
}
