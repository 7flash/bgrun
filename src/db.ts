import { Database, z, type AugmentedEntity } from "sqlite-zod-orm";
import { ensureDir } from "./platform";
import { join, dirname } from "path";
import { getBgrHome, getDatabasePath } from "./paths";
import { onDefaultBgrunRuntimeChange } from "./runtime-context";
import { parseEnvString, stringifyEnvString } from "./env";
import { existsSync } from "fs";
import { retry } from "./async-utils";
import { hasErrorCode } from "./error-utils";
import { selectLatestByName } from "./process-records";
import { updateEnvironmentSources } from "./process-environment";
import { migrateLegacyDatabase } from "./legacy-migration";
export const ProcessSchema = z.object({
  pid: z.number(),
  workdir: z.string(),
  command: z.string(),
  name: z.string(),
  env: z.string(),
  env_sources: z.string().default(""),
  configPath: z.string().default(""),
  stdout_path: z.string(),
  stderr_path: z.string(),
  timestamp: z.string().default(() => new Date().toISOString()),
  group: z.string().default(""),
  start_identity: z.string().default(""),
  argv: z.string().default(""),
});
export type Process = z.infer<typeof ProcessSchema> & {
  id: number;
};
export const TemplateSchema = z.object({
  name: z.string(),
  command: z.string(),
  workdir: z.string().default(""),
  env: z.string().default(""),
  group: z.string().default(""),
  created_at: z.string().default(() => new Date().toISOString()),
});
export type Template = z.infer<typeof TemplateSchema> & {
  id: number;
};
export const HistorySchema = z.object({
  process_name: z.string(),
  event: z.string(),
  pid: z.number().optional(),
  timestamp: z.string().default(() => new Date().toISOString()),
  metadata: z.string().default(""),
});
export type History = z.infer<typeof HistorySchema> & {
  id: number;
};
export const DependencySchema = z.object({
  process_name: z.string(),
  depends_on: z.string(),
  created_at: z.string().default(() => new Date().toISOString()),
});
export type Dependency = z.infer<typeof DependencySchema> & {
  id: number;
};
export type ProcessDatabase = Database<{
  process: typeof ProcessSchema;
  template: typeof TemplateSchema;
  history: typeof HistorySchema;
  dependency: typeof DependencySchema;
}>;

const databases = new Map<string, ProcessDatabase>();

function shouldAutoMigrateLegacyDb() {
  const raw = (process.env.BGRUN_DISABLE_LEGACY_MIGRATION || "")
    .trim()
    .toLowerCase();
  return !(raw === "1" || raw === "true" || raw === "yes");
}

function createDatabase(): ProcessDatabase {
  const activeHome = getBgrHome();
  const activeDbPath = getDatabasePath();
  ensureDir(activeHome);
  ensureDir(dirname(activeDbPath));

  const legacyDbPath = join(activeHome, "bgr_v2.sqlite");
  if (
    shouldAutoMigrateLegacyDb() &&
    !existsSync(activeDbPath) &&
    existsSync(legacyDbPath)
  ) {
    const migrated = migrateLegacyDatabase(legacyDbPath, activeDbPath);
    if (migrated)
      console.log(
        `[bgrun] Migrated database: ${legacyDbPath} → ${activeDbPath}`,
      );
  }

  return new Database(
    activeDbPath,
    {
      process: ProcessSchema,
      template: TemplateSchema,
      history: HistorySchema,
      dependency: DependencySchema,
    },
    {
      indexes: {
        process: ["name", "timestamp", "pid"],
        template: ["name"],
        history: ["process_name", "timestamp"],
        dependency: ["process_name", "depends_on"],
      },
    },
  );
}

export function getDb(): ProcessDatabase {
  const activeDbPath = getDatabasePath();
  let database = databases.get(activeDbPath);
  if (!database) {
    database = createDatabase();
    databases.set(activeDbPath, database);
  }
  return database;
}

export const db = new Proxy({} as ProcessDatabase, {
  get(_target, property) {
    const database = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export let dbPath = "";
export let bgrHome = "";
let dbFilename = "";
onDefaultBgrunRuntimeChange((runtime) => {
  dbPath = runtime.dbPath;
  bgrHome = runtime.home;
  dbFilename = runtime.dbPath.split(/[\\/]/).pop() || "bgrun.sqlite";
});

export function getProcess(name: string): Process | null {
  return (
    getDb()
      .process.select()
      .where({ name })
      .orderBy("timestamp", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .get() || null
  );
}
export function getAllProcesses(): Process[] {
  return getDb().process.select().all();
}
export function getCurrentProcesses(): Process[] {
  return selectLatestByName(getAllProcesses());
}
export type ProcessDefinitionInput = {
  pid: number;
  workdir: string;
  command: string;
  name: string;
  env: string;
  env_sources?: string;
  configPath: string;
  stdout_path: string;
  stderr_path: string;
  start_identity?: string;
  argv?: string;
};

export function insertProcess(
  data: ProcessDefinitionInput,
): AugmentedEntity<typeof ProcessSchema> {
  return getDb().process.insert({
    ...data,
    group: parseEnvString(data.env).BGR_GROUP || "",
    timestamp: new Date().toISOString(),
  });
}

export function replaceProcess(
  data: ProcessDefinitionInput,
): AugmentedEntity<typeof ProcessSchema> {
  return getDb().transaction(() => {
    const inserted = insertProcess(data);
    for (const row of getDb()
      .process.select()
      .where({ name: data.name })
      .all()) {
      if (row.id !== inserted.id) getDb().process.delete(row.id);
    }
    return inserted;
  });
}

export function updateProcessOwnership(
  name: string,
  pid: number,
  startIdentity: string,
): boolean {
  const proc = getProcess(name);
  if (!proc) return false;
  getDb().process.update(proc.id, { pid, start_identity: startIdentity });
  return true;
}

export function clearProcessOwnership(
  name: string,
  expected?: { pid: number; startIdentity?: string },
): boolean {
  return getDb().transaction(() => {
    const proc = getProcess(name);
    if (!proc) return false;
    if (expected) {
      if (proc.pid !== expected.pid) return false;
      if (
        expected.startIdentity !== undefined &&
        proc.start_identity !== expected.startIdentity
      ) {
        return false;
      }
    }
    if (proc.pid === 0 && !proc.start_identity) return true;
    getDb().process.update(proc.id, { pid: 0, start_identity: "" });
    return true;
  });
}

export function removeProcess(pid: number) {
  const matches = getDb().process.select().where({ pid }).all();
  for (const p of matches) {
    getDb().process.delete(p.id);
  }
}
export function removeProcessByName(name: string) {
  const matches = getDb().process.select().where({ name }).all();
  for (const p of matches) {
    getDb().process.delete(p.id);
  }
}
export function updateProcessPid(name: string, newPid: number) {
  const proc = getProcess(name);
  if (!proc) return;
  getDb().process.update(proc.id, {
    pid: newPid,
    ...(newPid === 0 ? { start_identity: "" } : {}),
  });
}
export function removeAllProcesses() {
  const all = getDb().process.select().all();
  for (const p of all) {
    getDb().process.delete(p.id);
  }
}
export function updateProcessEnv(name: string, envJson: string) {
  const proc = getProcess(name);
  if (proc) {
    const env = parseEnvString(envJson);
    getDb().process.update(proc.id, {
      env: stringifyEnvString(env),
      env_sources: updateEnvironmentSources(proc, env),
      group: env.BGR_GROUP || "",
    });
  }
}
export function getAllTemplates(): AugmentedEntity<typeof TemplateSchema>[] {
  return getDb().template.select().all();
}
export function getTemplate(
  name: string,
): AugmentedEntity<typeof TemplateSchema> | null {
  return getDb().template.select().where({ name }).limit(1).get() || null;
}
export function saveTemplate(data: {
  name: string;
  command: string;
  workdir?: string;
  env?: string;
  group?: string;
}) {
  const existing = getDb()
    .template.select()
    .where({ name: data.name })
    .limit(1)
    .get();
  if (existing) {
    getDb().template.update(existing.id, {
      command: data.command,
      workdir: data.workdir || "",
      env: data.env || "",
      group: data.group || "",
    });
  } else {
    getDb().template.insert({
      name: data.name,
      command: data.command,
      workdir: data.workdir || "",
      env: data.env || "",
      group: data.group || "",
    });
  }
}
export function deleteTemplate(name: string) {
  const tmpl = getDb().template.select().where({ name }).limit(1).get();
  if (tmpl) {
    getDb().template.delete(tmpl.id);
  }
}
export function getProcessHistory(name: string, limit = 50): History[] {
  return getDb()
    .history.select()
    .where({ process_name: name })
    .orderBy("timestamp", "desc")
    .limit(limit)
    .all();
}
export function addHistoryEntry(
  processName: string,
  event: string,
  pid?: number,
  metadata: Record<string, unknown> = {},
): AugmentedEntity<typeof HistorySchema> {
  return getDb().history.insert({
    process_name: processName,
    event,
    pid,
    metadata: JSON.stringify(metadata),
  });
}
export function getRecentHistory(limit = 100): History[] {
  return getDb()
    .history.select()
    .orderBy("timestamp", "desc")
    .limit(limit)
    .all();
}
export function getHistoryByEvent(event: string): History[] {
  return getDb().history.select().where({ event }).all();
}
export function getRecentHistoryByEvents(
  events: readonly string[],
  limit = 100,
): History[] {
  if (limit <= 0 || events.length === 0) return [];
  const rows = [...new Set(events)].flatMap((event) =>
    getDb()
      .history.select()
      .where({ event })
      .orderBy("timestamp", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .all(),
  );
  return rows
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id - a.id)
    .slice(0, limit);
}
export function clearOldHistory(daysToKeep = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const cutoffStr = cutoff.toISOString();
  const oldEntries = getDb()
    .history.select()
    .where({ timestamp: { $lt: cutoffStr } })
    .all();
  for (const entry of oldEntries) {
    getDb().history.delete(entry.id);
  }
  return oldEntries.length;
}
export function getDependencies(
  processName: string,
  envOverride?: string,
): string[] {
  const stored = getDb()
    .dependency.select()
    .where({ process_name: processName })
    .all()
    .map((d: Dependency) => d.depends_on);
  const env = parseEnvString(envOverride ?? getProcess(processName)?.env ?? "");
  return [
    ...new Set([
      ...stored,
      ...(env.BGR_DEPENDS_ON || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ]),
  ];
}
export function getDependents(processName: string): string[] {
  return [
    ...new Set([
      ...getDb()
        .dependency.select()
        .where({ depends_on: processName })
        .all()
        .map((d: Dependency) => d.process_name),
      ...getCurrentProcesses()
        .filter((p) => getDependencies(p.name).includes(processName))
        .map((p) => p.name),
    ]),
  ];
}
export function getDependencyGraph(): Record<string, string[]> {
  const all = getDb().dependency.select().all();
  const graph: Record<string, string[]> = Object.create(null);
  for (const dep of all) {
    if (!graph[dep.process_name]) graph[dep.process_name] = [];
    graph[dep.process_name].push(dep.depends_on);
  }
  for (const proc of getCurrentProcesses()) {
    const deps = getDependencies(proc.name);
    if (deps.length) graph[proc.name] = deps;
  }
  return graph;
}
export function addDependency(processName: string, dependsOn: string): boolean {
  if (processName === dependsOn) return false;
  const existing = getDb()
    .dependency.select()
    .where({ process_name: processName, depends_on: dependsOn })
    .limit(1)
    .get();
  if (existing) return false;
  if (wouldCreateCycle(processName, dependsOn)) return false;
  getDb().dependency.insert({
    process_name: processName,
    depends_on: dependsOn,
  });
  return true;
}
export function removeDependency(processName: string, dependsOn: string) {
  const matches = getDb()
    .dependency.select()
    .where({ process_name: processName, depends_on: dependsOn })
    .all();
  for (const dep of matches) {
    getDb().dependency.delete(dep.id);
  }
}
export function removeAllDependencies(processName: string) {
  const matches = getDb()
    .dependency.select()
    .where({ process_name: processName })
    .all();
  for (const dep of matches) {
    getDb().dependency.delete(dep.id);
  }
}
function wouldCreateCycle(processName: string, dependsOn: string): boolean {
  const graph = getDependencyGraph();
  if (!graph[processName]) graph[processName] = [];
  graph[processName].push(dependsOn);
  const visited = new Set<string>();
  const stack = [dependsOn];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === processName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of graph[current] || []) {
      stack.push(dep);
    }
  }
  return false;
}
export function getStartOrder(): string[] {
  const graph = getDependencyGraph();
  const allProcesses = getCurrentProcesses().map((p) => p.name);
  const allNames = new Set(allProcesses);
  const inDegree: Record<string, number> = Object.create(null);
  for (const name of allNames) inDegree[name] = 0;
  for (const [proc, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (allNames.has(dep)) {
        inDegree[proc] = (inDegree[proc] || 0) + 1;
      }
    }
  }
  const queue: string[] = [];
  for (const name of allNames) {
    if ((inDegree[name] || 0) === 0) queue.push(name);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const current = queue.shift()!;
    order.push(current);
    for (const [proc, deps] of Object.entries(graph)) {
      if (deps.includes(current) && allNames.has(proc)) {
        inDegree[proc]--;
        if (inDegree[proc] === 0) queue.push(proc);
      }
    }
  }
  if (order.length !== allNames.size)
    throw new Error("Dependency cycle prevents a complete startup order");
  return order;
}
export function getDbInfo() {
  const activeDbPath = getDatabasePath();
  const activeHome = getBgrHome();
  return {
    dbPath: activeDbPath,
    bgrHome: activeHome,
    dbFilename: activeDbPath.split(/[\\/]/).pop() || "bgrun.sqlite",
    exists: existsSync(activeDbPath),
  };
}
export async function retryDatabaseOperation<T>(
  operation: () => T | Promise<T>,
  maxRetries = 5,
  delay = 100,
): Promise<T> {
  return retry(operation, {
    attempts: maxRetries,
    delayMs: delay,
    shouldRetry: (error) => hasErrorCode(error, "SQLITE_BUSY"),
  });
}
