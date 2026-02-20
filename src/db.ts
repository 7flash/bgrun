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
});

export type Process = z.infer<typeof ProcessSchema> & { id: number };

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
}, {
    indexes: {
        process: ['name', 'timestamp', 'pid'],
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

export function removeAllProcesses() {
    const all = db.process.select().all();
    for (const p of all) {
        db.process.delete(p.id);
    }
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
