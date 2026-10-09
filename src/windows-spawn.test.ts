import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnProcess } from "./process-spawn";
import { windowsCaptureSync } from "./windows-spawn";
const windowsTest = process.platform === "win32" ? test : test.skip;
windowsTest(
  "native spawn preserves argument quoting and Unicode environment",
  async () => {
    const args = [
      "",
      "plain",
      "with spaces",
      'quote"inside',
      "ends with slash\\",
      "space slash \\",
      '\\\\"quoted',
      "雪",
    ];
    const p = await spawnProcess(
      [
        process.execPath,
        "-e",
        "console.log(JSON.stringify({args:process.argv.slice(1),env:process.env.BGR_NATIVE_UNICODE,cwd:process.cwd()}))",
        ...args,
      ],
      {
        env: { ...process.env, BGR_NATIVE_UNICODE: "héllo 雪" },
        cwd: process.cwd(),
      },
    );
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(JSON.parse(out)).toEqual({
      args,
      env: "héllo 雪",
      cwd: process.cwd(),
    });
  },
);
windowsTest(
  "native pipes drain more than pipe capacity on both streams",
  async () => {
    const p = await spawnProcess([
      process.execPath,
      "-e",
      `for(let i=0;i<256;i++){process.stdout.write('o'.repeat(4096));process.stderr.write('e'.repeat(4096));}`,
    ]);
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    expect(out).toBe("o".repeat(1024 * 1024));
    expect(err).toBe("e".repeat(1024 * 1024));
    expect(code).toBe(0);
  },
  15000,
);
windowsTest(
  "detached cmd preserves immediate grandchild stderr and appends logs",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "bgr-native-"));
    const out = join(dir, "out.log"),
      err = join(dir, "err.log");
    try {
      for (let i = 0; i < 2; i++) {
        const p = await spawnProcess(
          [
            "cmd.exe",
            "/d",
            "/s",
            "/c",
            `"${process.execPath}" -e "console.error('startup exploded');process.exit(42)"`,
          ],
          { detached: true, stdoutPath: out, stderrPath: err },
        );
        expect(await p.exited).toBe(42);
      }
      expect(readFileSync(err, "utf8")).toBe(
        "startup exploded\nstartup exploded\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
windowsTest("synchronous native capture drains stderr and times out", () => {
  expect(
    windowsCaptureSync([
      process.execPath,
      "-e",
      `process.stderr.write('e'.repeat(131072));console.log('capture done')`,
    ]),
  ).toBe("capture done\n");
  expect(() =>
    windowsCaptureSync(
      [process.execPath, "-e", "setInterval(()=>{},1000)"],
      100,
    ),
  ).toThrow("timed out");
});
windowsTest(
  "native spawn rejects NUL environment and missing executable",
  async () => {
    await expect(
      spawnProcess([process.execPath, "-e", "0"], { env: { BROKEN: "a\0b" } }),
    ).rejects.toThrow("environment");
    await expect(
      spawnProcess(["bgr-native-absent-executable-abcdef"]),
    ).rejects.toThrow("Executable not found");
  },
);