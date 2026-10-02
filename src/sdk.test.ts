import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBgrun } from "./sdk";

process.env.BGRUN_DISABLE_LEGACY_MIGRATION = "1";

const root = mkdtempSync(join(tmpdir(), "bgrun-sdk-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("createBgrun", () => {
  test("creates isolated lazy instances", async () => {
    const a = createBgrun({ home: join(root, "a") });
    const b = createBgrun({ home: join(root, "b"), db: "custom.sqlite" });

    expect(a.home).toBe(join(root, "a"));
    expect(a.dbPath).toBe(join(root, "a", "bgrun.sqlite"));
    expect(b.home).toBe(join(root, "b"));
    expect(b.dbPath).toBe(join(root, "b", "custom.sqlite"));
    expect(await a.list()).toEqual([]);
    expect(await b.list()).toEqual([]);
  });

  test("exposes the intentional process-manager surface", () => {
    const manager = createBgrun({ home: join(root, "surface") });
    for (const method of [
      "start",
      "ensure",
      "restart",
      "stop",
      "remove",
      "get",
      "list",
      "logs",
      "resources",
    ] as const) {
      expect(typeof manager[method]).toBe("function");
    }
  });
});
