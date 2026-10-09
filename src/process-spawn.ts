export interface ProcessSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: "ignore" | "inherit";
  stdout?: "ignore" | "inherit" | "pipe" | number;
  stderr?: "ignore" | "inherit" | "pipe" | number;
  stdoutPath?: string;
  stderrPath?: string;
  detached?: boolean;
  windowsHide?: boolean;
}
export interface SpawnedProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
  unref(): void;
}
export async function spawnProcess(
  argv: string[],
  options: ProcessSpawnOptions = {},
): Promise<SpawnedProcess> {
  if (process.platform === "win32")
    return (await import("./windows-spawn")).spawnWindowsProcess(argv, options);
  return Bun.spawn(argv, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin ?? "ignore",
    stdout: options.stdout ?? "pipe",
    stderr: options.stderr ?? "pipe",
    detached: options.detached,
    windowsHide: options.windowsHide,
  }) as SpawnedProcess;
}