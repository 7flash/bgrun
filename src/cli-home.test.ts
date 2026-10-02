import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliHome } from "./cli-home";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CLI home resolution", () => {
  test("prefers --home and resolves it from cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bgrun-cli-home-"));
    dirs.push(cwd);
    expect(await resolveCliHome(["--home", ".state"], cwd, {})).toBe(
      join(cwd, ".state"),
    );
  });

  test("reads [bgr] local_home from project config", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bgrun-cli-config-"));
    dirs.push(cwd);
    writeFileSync(join(cwd, ".config.toml"), '[bgr]\nlocal_home = ".data/bgr"\n');
    expect(await resolveCliHome([], cwd, {})).toBe(join(cwd, ".data", "bgr"));
  });

  test("leaves BGRUN_HOME precedence to runtime configuration", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bgrun-cli-env-"));
    dirs.push(cwd);
    writeFileSync(join(cwd, ".config.toml"), '[bgr]\nlocal_home = ".data/bgr"\n');
    expect(await resolveCliHome([], cwd, { BGRUN_HOME: "global" })).toBeUndefined();
  });
});
