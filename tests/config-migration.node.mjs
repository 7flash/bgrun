import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createFixture, createSourceLoader, projectRoot, sqliteAdapter } from './helpers/control-runtime.mjs';
function configurationFixture(t) {
    const f = createFixture(t, { overrides: [[path.join(projectRoot, 'src/config.ts'), {
                    parseConfigFile: async (filename) => JSON.parse(fs.readFileSync(filename, 'utf8')),
                }]] });
    const configPath = path.join(f.root, 'settings.json');
    return { ...f, configPath,
        configure: (env) => fs.writeFileSync(configPath, JSON.stringify(env)),
        stored: () => JSON.parse(f.db.getProcess('target').env),
        childEnv: () => f.controls.children.get(f.db.getProcess('target').pid).options.env,
    };
}
test('removing a configuration key removes it from the next process environment', async (t) => {
    const f = configurationFixture(t);
    f.configure({ REMOVE_ME: 'old', KEEP_ME: 'before' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: {} });
    f.configure({ KEEP_ME: 'after' });
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(f.stored().KEEP_ME, 'after');
    assert.equal(Object.hasOwn(f.stored(), 'REMOVE_ME'), false);
    assert.equal(Object.hasOwn(f.childEnv(), 'REMOVE_ME'), false);
});
test('explicit overrides retain precedence on automatic restarts', async (t) => {
    const f = configurationFixture(t);
    f.configure({ PORT: '3000' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: { PORT: '9000' } });
    assert.equal(f.childEnv().PORT, '9000');
    f.configure({ PORT: '4000' });
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(f.stored().PORT, '9000');
    assert.equal(f.childEnv().PORT, '9000');
});
test('a guard toggle does not pin unrelated configuration and stays disabled after reload', async (t) => {
    const f = configurationFixture(t);
    f.process.env.BGR_KEEP_ALIVE = 'true';
    f.configure({ BGR_KEEP_ALIVE: 'true', REMOVE_ME: 'old' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: {} });
    await f.loader.load('src/commands/guard.ts').handleGuardToggle('target', false);
    f.configure({ BGR_KEEP_ALIVE: 'true' });
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(Object.hasOwn(f.stored(), 'REMOVE_ME'), false);
    assert.notEqual(f.stored().BGR_KEEP_ALIVE, 'true');
    assert.notEqual(f.childEnv().BGR_KEEP_ALIVE, 'true');
});
test('disabling configuration drops its values while retaining explicit overrides', async (t) => {
    const f = configurationFixture(t);
    f.configure({ CONFIG_ONLY: 'old' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: { EXPLICIT: 'kept' } });
    await f.run.handleRun({ name: 'target', force: true, configPath: '' });
    assert.equal(Object.hasOwn(f.stored(), 'CONFIG_ONLY'), false);
    assert.equal(f.stored().EXPLICIT, 'kept');
});
test('inherited defaults remain below configuration and explicit overrides', async (t) => {
    const f = configurationFixture(t);
    f.process.env.BGR_GROUP = 'inherited';
    f.configure({ BGR_GROUP: 'configured' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: {} });
    assert.equal(f.stored().BGR_GROUP, 'configured');
    f.configure({});
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(f.stored().BGR_GROUP, 'inherited');
    await f.run.handleRun({ name: 'target', force: true, env: { BGR_GROUP: 'explicit' } });
    assert.equal(f.stored().BGR_GROUP, 'explicit');
    await f.run.handleRun({ name: 'target', force: true, env: {} });
    assert.equal(f.stored().BGR_GROUP, 'inherited');
});
test('legacy environments preserve unknown values until explicit overrides reset their origins', async (t) => {
    const f = configurationFixture(t);
    f.configure({ CONFIG: 'new' });
    f.seed('target', { pid: 0, configPath: f.configPath, env: JSON.stringify({ UNKNOWN: 'preserved', CONFIG: 'old' }) });
    await f.run.handleRun({ name: 'target' });
    assert.equal(f.stored().UNKNOWN, 'preserved');
    assert.equal(f.stored().CONFIG, 'new');
    await f.run.handleRun({ name: 'target', force: true, env: {} });
    assert.equal(Object.hasOwn(f.stored(), 'UNKNOWN'), false);
    f.configure({});
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(Object.hasOwn(f.stored(), 'CONFIG'), false);
});
test('invalid environment metadata cannot stop an existing process', async (t) => {
    const f = configurationFixture(t);
    await f.run.handleRun({ ...f.launch, env: {} });
    const previous = f.db.getProcess('target');
    f.db.db.process.update(previous.id, { env_sources: '{"version":999}' });
    await assert.rejects(f.run.handleRun({ name: 'target', force: true }), /Invalid environment source/);
    assert.equal(f.db.getProcess('target').pid, previous.pid);
    assert.equal(f.controls.children.get(previous.pid).alive, true);
    assert.equal(f.controls.spawnCalls, 1);
});
test('invalid explicit override values cannot replace a running process', async (t) => {
    const f = configurationFixture(t);
    await f.run.handleRun({ ...f.launch, env: {} });
    const previous = f.db.getProcess('target');
    for (const value of [undefined, 42, () => 'value', { nested: 'value' }]) {
        await assert.rejects(f.run.handleRun({ name: 'target', force: true, env: { INVALID: value } }), /Invalid environment entry/);
    }
    assert.equal(f.controls.children.get(previous.pid).alive, true);
    assert.equal(f.controls.spawnCalls, 1);
});
test('failed registration retains the previous environment sources', async (t) => {
    const f = configurationFixture(t);
    f.configure({ CONFIG: 'before' });
    await f.run.handleRun({ ...f.launch, configPath: f.configPath, env: { EXPLICIT: 'before' } });
    const previous = f.db.getProcess('target');
    f.configure({ CONFIG: 'after' });
    f.db.db.exec("CREATE TRIGGER reject_definition BEFORE INSERT ON process BEGIN SELECT RAISE(ABORT, 'injected registration failure'); END");
    await assert.rejects(f.run.handleRun({ name: 'target', force: true, env: { EXPLICIT: 'after' } }), /registration failure/);
    assert.equal(f.db.getProcess('target').env_sources, previous.env_sources);
    assert.equal(f.db.getProcess('target').env, previous.env);
});
test('explicit environment deletions suppress inherited values and can be reset', async (t) => {
    const f = configurationFixture(t);
    f.process.env.REMOVED = 'inherited';
    await f.run.handleRun({ ...f.launch, env: { REMOVED: 'explicit', KEEP: 'yes' } });
    const next = f.stored();
    delete next.REMOVED;
    f.db.updateProcessEnv('target', JSON.stringify(next));
    await f.run.handleRun({ name: 'target', force: true });
    assert.equal(Object.hasOwn(f.childEnv(), 'REMOVED'), false);
    assert.equal(f.stored().KEEP, 'yes');
    await f.run.handleRun({ name: 'target', force: true, env: {} });
    assert.equal(f.childEnv().REMOVED, 'inherited');
});
function migrationFixture(t, packages = {}) {
    const root = fs.mkdtempSync(path.join(projectRoot, '.test-state-migration-'));
    const connections = [];
    const source = path.join(root, 'legacy.sqlite');
    const target = path.join(root, 'new.sqlite');
    t.after(() => {
        for (const connection of connections.reverse()) {
            if (connection instanceof DatabaseSync) {
                if (connection.isOpen)
                    connection.close();
            }
            else
                connection.close();
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
    const writer = new DatabaseSync(source);
    connections.push(writer);
    writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT); PRAGMA wal_checkpoint(TRUNCATE);');
    writer.prepare('INSERT INTO records(value) VALUES (?)').run('committed in WAL');
    const loader = createSourceLoader({ packages: { 'bun:sqlite': { Database: sqliteAdapter(connections) }, ...packages } });
    return { root, source, target, writer, connections, loader };
}
test('legacy initialization includes committed WAL data', (t) => {
    let writer;
    const f = createFixture(t, { beforeLoad({ root, process }) {
            delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION;
            writer = new DatabaseSync(path.join(root, 'bgr_v2.sqlite'));
            writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE legacy_probe(value TEXT); PRAGMA wal_checkpoint(TRUNCATE);');
            writer.prepare('INSERT INTO legacy_probe VALUES (?)').run('committed in WAL');
        } });
    const reader = new DatabaseSync(f.db.dbPath, { readOnly: true });
    try {
        assert.equal(reader.prepare('SELECT value FROM legacy_probe').get()?.value, 'committed in WAL');
    }
    finally {
        reader.close();
        writer.close();
    }
});
test('failed legacy migration aborts initialization instead of creating an empty registry', (t) => {
    assert.throws(() => createFixture(t, {
        packages: { fs: { ...fs, copyFileSync() { throw new Error('injected migration failure'); } } },
        beforeLoad({ root, process }) {
            delete process.env.BGRUN_DISABLE_LEGACY_MIGRATION;
            fs.writeFileSync(path.join(root, 'bgr_v2.sqlite'), 'not a SQLite database');
        },
    }), /migrat|database/i);
});
test('the SQLite snapshot preserves WAL commits and leaves the source unchanged', (t) => {
    const f = migrationFixture(t);
    const sourceBytes = fs.readFileSync(f.source);
    const migrate = f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase;
    assert.equal(migrate(f.source, f.target), true);
    if (process.platform !== 'win32')
        assert.equal(fs.statSync(f.target).mode & 0o777, 0o600);
    const reader = new DatabaseSync(f.target, { readOnly: true });
    try {
        assert.equal(reader.prepare('SELECT value FROM records').get().value, 'committed in WAL');
    }
    finally {
        reader.close();
    }
    assert.deepEqual(fs.readFileSync(f.source), sourceBytes);
    assert.equal(f.writer.prepare('SELECT COUNT(*) AS count FROM records').get().count, 1);
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith('.bgrun-migrate-')), false);
});
test('migration does not replace an existing destination', (t) => {
    const f = migrationFixture(t);
    fs.writeFileSync(f.target, 'existing destination');
    assert.equal(f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(f.source, f.target), false);
    assert.equal(fs.readFileSync(f.target, 'utf8'), 'existing destination');
});
test('competing publication cannot overwrite the winner', (t) => {
    const f = migrationFixture(t, { 'node:fs': { ...fs, linkSync(source, target) {
                fs.writeFileSync(target, 'concurrent winner');
                fs.linkSync(source, target);
            } } });
    assert.equal(f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(f.source, f.target), false);
    assert.equal(fs.readFileSync(f.target, 'utf8'), 'concurrent winner');
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith('.bgrun-migrate-')), false);
});
test('publication failure leaves the source available and no destination file', (t) => {
    const f = migrationFixture(t, { 'node:fs': { ...fs, linkSync() {
                throw Object.assign(new Error('injected publication failure'), { code: 'EACCES' });
            } } });
    assert.throws(() => f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(f.source, f.target), /startup was aborted/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(f.writer.prepare('SELECT COUNT(*) AS count FROM records').get().count, 1);
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith('.bgrun-migrate-')), false);
});
test('orphaned destination WAL data is retained and blocks automatic migration', (t) => {
    const f = migrationFixture(t);
    fs.writeFileSync(`${f.target}-wal`, 'orphaned data');
    assert.throws(() => f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(f.source, f.target), /startup was aborted/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(fs.readFileSync(`${f.target}-wal`, 'utf8'), 'orphaned data');
});
test('migration paths are bound as data when filenames contain quotes', (t) => {
    const f = migrationFixture(t);
    const target = path.join(f.root, "user's database.sqlite");
    assert.equal(f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(f.source, target), true);
    const reader = new DatabaseSync(target, { readOnly: true });
    try {
        assert.equal(reader.prepare('SELECT COUNT(*) AS count FROM records').get().count, 1);
    }
    finally {
        reader.close();
    }
});
test('a corrupt legacy database cannot publish a destination', (t) => {
    const f = migrationFixture(t);
    const corrupt = path.join(f.root, 'corrupt.sqlite');
    fs.writeFileSync(corrupt, 'invalid SQLite bytes');
    assert.throws(() => f.loader.load('src/legacy-migration.ts').migrateLegacyDatabase(corrupt, f.target), /startup was aborted/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(fs.readdirSync(f.root).some((name) => name.startsWith('.bgrun-migrate-')), false);
});
