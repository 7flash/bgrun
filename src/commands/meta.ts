import { existsSync, statSync } from "fs";
import { bgrHome, dbPath, getAllProcesses, getDbInfo } from "../db";
import { getVersion } from "../utils";

export type MetaOptions = {
  json?: boolean;
};

function safeStat(path: string) {
  try {
    if (!existsSync(path)) return { exists: false };
    const stat = statSync(path);
    return {
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    return {
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function duplicateNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => name)
    .sort();
}

export function getBgrunMeta() {
  const rows = getAllProcesses();
  const names = rows.map((row) => row.name).sort();

  return {
    version: getVersion(),
    runtime: `bun ${Bun.version}`,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    cwd: process.cwd(),
    execPath: process.execPath,
    argv0: process.argv0,
    home: process.env.HOME ?? process.env.USERPROFILE ?? null,
    bgrHome,
    dbPath,
    db: {
      ...safeStat(dbPath),
      info: getDbInfo(),
    },
    env: {
      BGRUN_DB: process.env.BGRUN_DB ?? null,
      BGRUN_HOME: process.env.BGRUN_HOME ?? null,
      BGR_PROCESS_NAME: process.env.BGR_PROCESS_NAME ?? null,
      BGR_PARENT_NAME: process.env.BGR_PARENT_NAME ?? null,
    },
    processes: {
      count: rows.length,
      uniqueNames: new Set(names).size,
      duplicateNames: duplicateNames(names),
    },
  };
}

export function handleMeta(options: MetaOptions = {}) {
  const meta = getBgrunMeta();

  if (options.json) {
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  console.log("");
  console.log("bgrun metadata");
  console.log("══════════════");
  console.log(`Version:       ${meta.version}`);
  console.log(`Runtime:       ${meta.runtime}`);
  console.log(`Platform:      ${meta.platform} ${meta.arch}`);
  console.log(`PID:           ${meta.pid}`);
  console.log(`CWD:           ${meta.cwd}`);
  console.log(`Exec Path:     ${meta.execPath}`);
  console.log(`Home:          ${meta.home ?? "(unknown)"}`);
  console.log("");
  console.log("Storage");
  console.log("───────");
  console.log(`BGR Home:      ${meta.bgrHome}`);
  console.log(`DB Path:       ${meta.dbPath}`);
  console.log(
    `BGRUN_DB:      ${meta.env.BGRUN_DB ?? "(default bgrun.sqlite)"}`,
  );
  console.log(`DB Exists:     ${meta.db.exists ? "yes" : "no"}`);
  if ("sizeBytes" in meta.db)
    console.log(`DB Size:       ${meta.db.sizeBytes} bytes`);
  if ("modifiedAt" in meta.db)
    console.log(`DB Modified:   ${meta.db.modifiedAt}`);
  console.log("");
  console.log("Registry");
  console.log("────────");
  console.log(`Rows:          ${meta.processes.count}`);
  console.log(`Unique Names:  ${meta.processes.uniqueNames}`);
  console.log(
    `Duplicates:    ${meta.processes.duplicateNames.length ? meta.processes.duplicateNames.join(", ") : "none"}`,
  );
  console.log("");
}
