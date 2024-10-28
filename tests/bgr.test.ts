import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import * as fs from "fs/promises";
import { Database } from "bun:sqlite";
import { sleep, $ } from "bun";

const isWindows = process.platform === "win32";

// --- Test Configuration ---
const testDir = join(import.meta.dir, "test_env");
const appDir = join(testDir, "my-app");
// We use BGRUN_DB env var to point to a test DB
const testDbName = "test_bgr.sqlite";
const homePath = process.env.USERPROFILE || process.env.HOME || "";
const dbPath = join(homePath, ".bgr", testDbName);
// Corrected path: Go up one level from `tests` to the project root, then into `src`.
const scriptPath = join(import.meta.dir, "..", "src", "index.ts");

// --- Helper Functions ---

/** Runs the bgr script as a subprocess with specified arguments. */
const runBgr = async (args: string[]) => {
    const proc = Bun.spawn(
        ["bun", "run", scriptPath, ...args],
        {
            stdout: "pipe",
            stderr: "pipe",
            env: {
                ...Bun.env,
                BGRUN_DB: testDbName // Use test database
            }
        }
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    return { exitCode, stdout, stderr };
};

/** Polls a file until it contains the expected content or times out. */
const waitForFileContent = async (filePath: string, expectedContent: string, timeout = 10000): Promise<string> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        try {
            const content = await fs.readFile(filePath, "utf-8");
            if (content.includes(expectedContent)) {
                return content;
            }
        } catch (e) {
            // Ignore errors if file doesn't exist yet
        }
        await sleep(100); // Wait before retrying
    }
    // Return last known content on timeout for better error messages
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch {
        return ""; // File never appeared
    }
};


/** Cleans up all test artifacts (directories, DB, running processes). */
const cleanup = async () => {
    // Terminate any running test processes recorded in the DB
    try {
        const db = new Database(dbPath);
        // SatiDB uses singular table name "process"
        const pids = db.query<{ pid: number }, []>(`SELECT pid FROM process`).all();
        db.close();

        for (const { pid } of pids) {
            try {
                if (isWindows) {
                    await $`taskkill /F /PID ${pid}`.quiet().nothrow();
                } else {
                    process.kill(pid, 'SIGKILL');
                }
            } catch (e) {
                // Ignore errors if the process is already dead
            }
        }
    } catch (e) { /* Ignore if DB doesn't exist */ }

    // Wait a moment for processes to fully terminate and release file handles
    await sleep(500);

    // Remove the temporary test directory with retries for Windows file locking
    for (let i = 0; i < 3; i++) {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
            break;
        } catch (e) {
            if (i < 2) await sleep(500);
        }
    }

    // Also try to remove the test database
    try {
        await fs.rm(dbPath, { force: true });
    } catch { /* ignore */ }
};

// --- Test Suite ---

// Setup before all tests run
beforeAll(async () => {
    await cleanup(); // Ensure a clean state
    await fs.mkdir(appDir, { recursive: true });
    // Create a dummy .git directory as required by validateDirectory()
    await fs.mkdir(join(appDir, ".git"), { recursive: true });
});

// Teardown after all tests have run
afterAll(async () => {
    await cleanup();
});

describe("bgr Process Manager Fixes", () => {

    test("Bug 1 Fix: Should start a process successfully when default .config.toml is missing", async () => {
        const args = [
            "--name", "app-no-config",
            "--directory", appDir,
            "--command", "bun --version"
        ];
        const { exitCode, stdout, stderr } = await runBgr(args);

        // Assertions
        expect(stderr).not.toContain("Error:");
        expect(stdout).toContain("Config file '.config.toml' not found");
        expect(stdout).toContain("🚀 Launched process \"app-no-config\"");
        expect(exitCode).toBe(0);

        // Verify database entry - SatiDB uses singular "process" table
        const db = new Database(dbPath);
        const proc = db.query(`SELECT * FROM process WHERE name = ?`).get("app-no-config") as any;
        db.close();

        expect(proc).toBeDefined();
        expect(proc.name).toBe("app-no-config");
        expect(proc.configPath).toBe(".config.toml"); // Should store the default path it looked for
    }, 20000);

    test("Bug 2 Fix: Should remember and use custom config path on restart", async () => {
        // 1. Create a custom config file
        const customConfigName = "prod.config.ts";
        const customConfigPath = join(appDir, customConfigName);
        const outLogPath = join(testDir, "app-with-config-out.log");
        // Bun can import .ts files, making this easy.
        await fs.writeFile(customConfigPath, `export default { settings: { MY_VAR: "bug_was_fixed" } };`);

        // 2. Create a small script to print the env var (bun -e + cmd /c + Bun.file redirect is broken on Windows)
        const printEnvScript = join(appDir, "_print_env.ts");
        await fs.writeFile(printEnvScript, `console.log(process.env.SETTINGS_MY_VAR);\n`);

        // 3. Start the process with the custom config
        const startArgs = [
            "--name", "app-with-config",
            "--directory", appDir,
            "--command", `bun run ${printEnvScript}`,
            "--config", customConfigName,
            "--stdout", outLogPath,
        ];
        const startResult = await runBgr(startArgs);

        expect(startResult.stderr).not.toContain("Error:");
        expect(startResult.stdout).toContain("🚀 Launched process \"app-with-config\"");

        // Verify DB entry has the correct custom config path
        let db = new Database(dbPath);
        const proc1 = db.query(`SELECT * FROM process WHERE name = ?`).get("app-with-config") as any;
        db.close();

        expect(proc1).toBeDefined();
        expect(proc1.configPath).toBe(customConfigName);

        // 4. Restart the process WITHOUT specifying --config again
        const restartArgs = ["app-with-config", "--restart", "--force"];
        const restartResult = await runBgr(restartArgs);
        await sleep(3000); // Give process time to execute and write output

        expect(restartResult.stderr).not.toContain("Error:");
        expect(restartResult.stdout).toContain(`Loaded config from ${customConfigName}`);
        expect(restartResult.stdout).toContain("🔄 Restarted process \"app-with-config\"");

        // 5. Verify the correct config was used by checking the output log.
        const logContent = await waitForFileContent(outLogPath, "bug_was_fixed");
        expect(logContent.trim()).toBe("bug_was_fixed");

    }, 30000);
});
