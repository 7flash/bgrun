import { Database, z } from "sqlite-zod-orm";
import { getHomeDir, ensureDir } from "./platform";
import { join } from "path";
import { sleep } from "bun";
import { existsSync, copyFileSync } from "fs";

// =============================================================================
// SCHEMA (inline — single table, no need for a separate file)
// =============================================================================

export const ProcessSchema = z.object({
    pid: z.number(),
    workdir: z.string(),
    command: z.string(),
    name: z.string(),
    env: z.string(),
    configPath: z.string().default(''),
    stdout_path: z.string(),
    stderr_path: z.string(),
    timestamp: z.string().default(() => new Date().toISOString()),
    group: z.string().default(''),
});

export type Process = z.infer<typeof ProcessSchema> & { id: number };

export const TemplateSchema = z.object({
    name: z.string(),
    command: z.string(),
    workdir: z.string().default(''),
    env: z.string().default(''),
    group: z.string().default(''),
    created_at: z.string().default(() => new Date().toISOString()),
});

export type Template = z.infer<typeof TemplateSchema> & { id: number };

export const HistorySchema = z.object({
    process_name: z.string(),
    event: z.string(), // 'start', 'stop', 'restart', 'crash', 'guard_on', 'guard_off'
    pid: z.number().optional(),
    timestamp: z.string().default(() => new Date().toISOString()),
    metadata: z.string().default(''), // JSON string for extra info
});

export type History = z.infer<typeof HistorySchema> & { id: number };

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

const homePath = getHomeDir();
const bgrDir = join(homePath, ".bgr");
ensureDir(bgrDir);

// DB filename: configurable via BGRUN_DB env, default "bgrun.sqlite"
const dbFilename = process.env.BGRUN_DB ?? "bgrun.sqlite";
export const dbPath = join(bgrDir, dbFilename);
export const bgrHome = bgrDir;

// Auto-migration: if new DB doesn't exist but old one does, copy it over
const legacyDbPath = join(bgrDir, "bgr_v2.sqlite");
if (!existsSync(dbPath) && existsSync(legacyDbPath)) {
    try {
        copyFileSync(legacyDbPath, dbPath);
        console.log(`[bgrun] Migrated database: ${legacyDbPath} → ${dbPath}`);
    } catch (e) {
        // Migration failed — start fresh
    }
}

export const db = new Database(dbPath, {
    process: ProcessSchema,
    template: TemplateSchema,
    history: HistorySchema,
}, {
    indexes: {
        process: ['name', 'timestamp', 'pid'],
        template: ['name'],
        history: ['process_name', 'timestamp'],
    },
});

// =============================================================================
// QUERY FUNCTIONS
// =============================================================================

export function getProcess(name: string) {
    return db.process.select()
        .where({ name })
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get() || null;
}

export function getAllProcesses() {
    return db.process.select().all();
}

// =============================================================================
// MUTATION FUNCTIONS
// =============================================================================

export function insertProcess(data: {
    pid: number;
    workdir: string;
    command: string;
    name: string;
    env: string;
    configPath: string;
    stdout_path: string;
    stderr_path: string;
}) {
    return db.process.insert({
        ...data,
        timestamp: new Date().toISOString(),
    });
}

export function removeProcess(pid: number) {
    const matches = db.process.select().where({ pid }).all();
    for (const p of matches) {
        db.process.delete(p.id);
    }
}

export function removeProcessByName(name: string) {
    const matches = db.process.select().where({ name }).all();
    for (const p of matches) {
        db.process.delete(p.id);
    }
}

/** Update the stored PID for a process (used by PID reconciliation) */
export function updateProcessPid(name: string, newPid: number) {
    const proc = db.process.select().where({ name }).limit(1).get();
    if (proc) {
        db.process.update(proc.id, { pid: newPid });
    }
}

export function removeAllProcesses() {
    const all = db.process.select().all();
    for (const p of all) {
        db.process.delete(p.id);
    }
}

/** Update the stored env JSON for a process (used by guard toggle) */
export function updateProcessEnv(name: string, envJson: string) {
    const proc = db.process.select().where({ name }).limit(1).get();
    if (proc) {
        db.process.update(proc.id, { env: envJson });
    }
}

// =============================================================================
// TEMPLATE FUNCTIONS
// =============================================================================

export function getAllTemplates() {
    return db.template.select().all();
}

export function getTemplate(name: string) {
    return db.template.select().where({ name }).limit(1).get() || null;
}

export function saveTemplate(data: {
    name: string;
    command: string;
    workdir?: string;
    env?: string;
    group?: string;
}) {
    const existing = db.template.select().where({ name: data.name }).limit(1).get();
    if (existing) {
        db.template.update(existing.id, {
            command: data.command,
            workdir: data.workdir || '',
            env: data.env || '',
            group: data.group || '',
        });
    } else {
        db.template.insert({
            name: data.name,
            command: data.command,
            workdir: data.workdir || '',
            env: data.env || '',
            group: data.group || '',
        });
    }
}

export function deleteTemplate(name: string) {
    const tmpl = db.template.select().where({ name }).limit(1).get();
    if (tmpl) {
        db.template.delete(tmpl.id);
    }
}

// =============================================================================
// HISTORY FUNCTIONS
// =============================================================================

export function getProcessHistory(name: string, limit = 50) {
    return db.history.select()
        .where({ process_name: name })
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .all();
}

export function addHistoryEntry(processName: string, event: string, pid?: number, metadata = {}) {
    return db.history.insert({
        process_name: processName,
        event,
        pid,
        metadata: JSON.stringify(metadata),
    });
}

export function getRecentHistory(limit = 100) {
    return db.history.select()
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .all();
}

export function clearOldHistory(daysToKeep = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString();
    
    const oldEntries = db.history.select()
        .where('timestamp', '<', cutoffStr)
        .all();
    
    for (const entry of oldEntries) {
        db.history.delete(entry.id);
    }
    
    return oldEntries.length;
}

// =============================================================================
// DEBUG / INFO
// =============================================================================

export function getDbInfo() {
    return {
        dbPath,
        bgrHome,
        dbFilename,
        exists: existsSync(dbPath),
    };
}

// =============================================================================
// UTILITIES
// =============================================================================

export async function retryDatabaseOperation<T>(operation: () => T, maxRetries = 5, delay = 100): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return operation();
        } catch (err: any) {
            if (err?.code === 'SQLITE_BUSY' && attempt < maxRetries) {
                await sleep(delay * attempt);
                continue;
            }
            throw err;
        }
    }
    throw new Error('Max retries reached for database operation');
}
