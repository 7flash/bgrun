import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getProcess } from "../../src/db";
import { handleRun } from "../../src/commands/run";
import { handleDelete } from "../../src/commands/cleanup";
import { parseEnvString } from "../../src/env";
import { migrateLegacyDatabase } from "../../src/legacy-migration";
const root = process.env.BGRUN_HOME!;
if (!root?.includes(".test-state-"))
  throw new Error(
    "Configuration and migration tests require isolated test state",
  );
test("native restarts reload TOML and preserve explicit overrides", async () => {
  const name = `env-${randomUUID()}`;
  const directory = mkdtempSync(join(root, "environment-"));
  const configPath = join(directory, "settings.toml");
  const output = join(directory, "observed.json");
  writeFileSync(configPath, 'config_only = "before"\nport = 3000\n');
  try {
    await handleRun({
      name,
      command: "environment test",
      directory,
      configPath,
      argv: [
        process.execPath,
        "-e",
        'require("node:fs").writeFileSync("observed.json", JSON.stringify({ port: process.env.PORT, config: process.env.CONFIG_ONLY })); setInterval(() => {}, 1000)',
      ],
      env: { PORT: "9000", BGR_KEEP_ALIVE: "false" },
    });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({
      port: "9000",
      config: "before",
    });
    writeFileSync(configPath, "port = 4000\n");
    await handleRun({ name, force: true });
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual({ port: "9000" });
    expect(parseEnvString(getProcess(name)!.env).CONFIG_ONLY).toBeUndefined();
  } finally {
    if (getProcess(name)) await handleDelete(name);
    rmSync(directory, { recursive: true, force: true });
  }
});
test("native SQLite migration includes WAL commits and preserves an existing destination", () => {
  const directory = mkdtempSync(join(root, "migration-"));
  const source = join(directory, "legacy.sqlite");
  const target = join(directory, "current.sqlite");
  const writer = new Database(source);
  try {
    writer.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(value TEXT); PRAGMA wal_checkpoint(TRUNCATE);",
    );
    writer.query("INSERT INTO records VALUES (?)").run("committed in WAL");
    expect(migrateLegacyDatabase(source, target)).toBe(true);
    const reader = new Database(target, { readonly: true });
    try {
      expect(reader.query("SELECT value FROM records").get()).toEqual({
        value: "committed in WAL",
      });
    } finally {
      reader.close();
    }
    writer.query("INSERT INTO records VALUES (?)").run("later source change");
    const before = readFileSync(target);
    expect(migrateLegacyDatabase(source, target)).toBe(false);
    expect(readFileSync(target)).toEqual(before);
  } finally {
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("native migration failure does not leave a partial destination", () => {
  const directory = mkdtempSync(join(root, "migration-failure-"));
  const source = join(directory, "invalid.sqlite");
  const target = join(directory, "current.sqlite");
  writeFileSync(source, "invalid SQLite bytes");
  try {
    expect(() => migrateLegacyDatabase(source, target)).toThrow(
      "startup was aborted",
    );
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(source, "utf8")).toBe("invalid SQLite bytes");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
