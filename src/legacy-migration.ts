import { Database } from "bun:sqlite";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
export function migrateLegacyDatabase(
  sourcePath: string,
  targetPath: string,
): boolean {
  if (existsSync(targetPath) || !existsSync(sourcePath)) return false;
  const staging = mkdtempSync(join(dirname(targetPath), ".bgrun-migrate-"));
  const snapshot = join(staging, "snapshot.sqlite");
  try {
    const reservation = openSync(snapshot, "wx", 0o600);
    closeSync(reservation);
    const source = new Database(sourcePath, { readonly: true });
    try {
      source.exec("PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
      source.query("VACUUM INTO ?").run(snapshot);
    } finally {
      source.close();
    }
    const check = new Database(snapshot, { readonly: true });
    try {
      const rows = check
        .query<
          {
            quick_check: string;
          },
          []
        >("PRAGMA quick_check")
        .all();
      if (rows.length !== 1 || rows[0]?.quick_check !== "ok")
        throw new Error("SQLite snapshot failed its integrity check");
    } finally {
      check.close();
    }
    const descriptor = openSync(snapshot, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (existsSync(targetPath)) return false;
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (existsSync(`${targetPath}${suffix}`))
        throw new Error(
          `Destination has an orphaned SQLite sidecar: ${targetPath}${suffix}`,
        );
    }
    try {
      linkSync(snapshot, targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    return true;
  } catch (error) {
    throw new Error(
      `Legacy database migration from '${sourcePath}' to '${targetPath}' failed; startup was aborted`,
      { cause: error },
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
