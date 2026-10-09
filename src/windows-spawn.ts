import { dlopen, ptr, FFIType } from "bun:ffi";
import { resolve } from "node:path";
import type { ProcessSpawnOptions, SpawnedProcess } from "./process-spawn";
// No Bun.spawn boundary: CreateProcessW inherits only the three explicit stdio handles.
const k = (
  process.platform === "win32"
    ? dlopen("kernel32.dll", {
        GetLastError: { args: [], returns: "u32" },
        GetCurrentProcess: { args: [], returns: "u64" },
        GetStdHandle: { args: ["u32"], returns: "u64" },
        CloseHandle: { args: ["u64"], returns: "i32" },
        DuplicateHandle: {
          args: ["u64", "u64", "u64", "ptr", "u32", "i32", "u32"],
          returns: "i32",
        },
        CreateFileW: {
          args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "u64"],
          returns: "u64",
        },
        CreatePipe: { args: ["ptr", "ptr", "ptr", "u32"], returns: "i32" },
        SetHandleInformation: { args: ["u64", "u32", "u32"], returns: "i32" },
        InitializeProcThreadAttributeList: {
          args: ["ptr", "u32", "u32", "ptr"],
          returns: "i32",
        },
        UpdateProcThreadAttribute: {
          args: [
            "ptr",
            "u32",
            FFIType.u64_fast,
            "ptr",
            FFIType.u64_fast,
            "ptr",
            "ptr",
          ],
          returns: "i32",
        },
        DeleteProcThreadAttributeList: { args: ["ptr"], returns: "void" },
        CreateProcessW: {
          args: [
            "ptr",
            "ptr",
            "ptr",
            "ptr",
            "i32",
            "u32",
            "ptr",
            "ptr",
            "ptr",
            "ptr",
          ],
          returns: "i32",
        },
        WaitForSingleObject: { args: ["u64", "u32"], returns: "u32" },
        GetExitCodeProcess: { args: ["u64", "ptr"], returns: "i32" },
        TerminateProcess: { args: ["u64", "u32"], returns: "i32" },
        PeekNamedPipe: {
          args: ["u64", "ptr", "u32", "ptr", "ptr", "ptr"],
          returns: "i32",
        },
        ReadFile: { args: ["u64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
      }).symbols
    : null
)!;
const wide = (s: string) => Buffer.from(s + "\0", "utf16le");
const view = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);
const handleAt = (b: Uint8Array, n = 0) => view(b).getBigUint64(n, true);
const setHandle = (b: Uint8Array, n: number, h: number | bigint) =>
  view(b).setBigUint64(n, BigInt(h), true);
const failure = (operation: string) =>
  new Error(`${operation} failed (Windows error ${k.GetLastError()})`);
function valid(h: number | bigint | null): h is bigint {
  return typeof h === "bigint" && h !== 0n && h !== 0xffffffffffffffffn;
}
export function quoteWindowsArgument(s: string): string {
  if (s.length && !/[\s"]/u.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1") + '"';
}
export function spawnWindowsProcess(
  argv: string[],
  options: ProcessSpawnOptions,
  capture?: { timeoutMs: number; text: string },
): SpawnedProcess {
  if (process.arch !== "x64" && process.arch !== "arm64")
    throw new Error("Windows handle whitelist requires 64-bit Bun");
  if (!argv.length) throw new Error("Cannot spawn an empty command");
  if (argv.some((arg) => arg.includes("\0")) || options.cwd?.includes("\0"))
    throw new Error("Process arguments and cwd cannot contain NUL");
  const values = options.env ?? process.env;
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (
      !name ||
      name.includes("=") ||
      name.includes("\0") ||
      value.includes("\0")
    )
      throw new Error("Invalid Windows environment entry");
  }
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  let executable = Bun.which(argv[0]!, {
    cwd,
    PATH: options.env?.PATH ?? options.env?.Path ?? process.env.PATH,
  });
  if (!executable) throw new Error(`Executable not found: ${argv[0]}`);
  if (/\.(?:cmd|bat)$/i.test(executable)) {
    // Batch files must pass through cmd.exe; CreateProcessW cannot load them.
    const shell = Bun.which(process.env.ComSpec ?? "cmd.exe", { cwd });
    if (!shell) throw new Error("cmd.exe not found for Windows batch command");
    argv = [
      shell,
      "/d",
      "/s",
      "/c",
      [executable, ...argv.slice(1)].map(quoteWindowsArgument).join(" "),
    ];
    executable = shell;
  }
  const cmdIndex = /(?:^|[\\/])cmd(?:\.exe)?$/i.test(executable)
    ? argv.findIndex((arg) => /^\/c$/i.test(arg))
    : -1;
  const command = wide(
    cmdIndex >= 0
      ? [quoteWindowsArgument(executable), ...argv.slice(1, cmdIndex + 1)].join(
          " ",
        ) +
          ' "' +
          argv.slice(cmdIndex + 1).join(" ") +
          '"'
      : [executable, ...argv.slice(1)].map(quoteWindowsArgument).join(" "),
  );
  const application = wide(executable),
    directory = wide(cwd);
  const environment = wide(
    Object.entries(values)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .sort(([a], [b]) => {
        const x = a.toUpperCase(),
          y = b.toUpperCase();
        return x < y ? -1 : x > y ? 1 : 0;
      })
      .map(([a, b]) => `${a}=${b}`)
      .join("\0") + "\0",
  );
  const owned = new Set<bigint>();
  const close = (h: bigint) => {
    if (owned.delete(h)) k.CloseHandle(h);
  };
  const keep = (h: number | bigint | null, operation: string) => {
    if (!valid(h)) throw failure(operation);
    owned.add(h);
    return h;
  };
  const security = Buffer.alloc(24);
  view(security).setUint32(0, 24, true);
  view(security).setInt32(16, 1, true);
  const pipes: Array<{ handle: bigint; kind: "stdout" | "stderr" }> = [];
  let attributes: Buffer | undefined,
    attributesReady = false,
    processHandle = 0n;
  try {
    const standard = (
      kind: "stdin" | "stdout" | "stderr",
      id: number,
    ): bigint => {
      const mode = options[kind] ?? (kind === "stdin" ? "ignore" : "pipe");
      const path = kind === "stdin" ? undefined : options[`${kind}Path`];
      if (path || mode === "ignore") {
        const file = wide(path ? resolve(path) : "NUL");
        // Append-only handles preserve concurrent logging without a shared offset.
        return keep(
          k.CreateFileW(
            ptr(file),
            kind === "stdin" ? 0x80000000 : path ? 4 : 0x40000000,
            7,
            ptr(security),
            path ? 4 : 3,
            0x80,
            0n,
          ),
          "CreateFileW",
        );
      }
      if (mode === "pipe") {
        const read = Buffer.alloc(8),
          write = Buffer.alloc(8);
        if (!k.CreatePipe(ptr(read), ptr(write), ptr(security), 0))
          throw failure("CreatePipe");
        const reader = keep(handleAt(read), "CreatePipe"),
          writer = keep(handleAt(write), "CreatePipe");
        if (!k.SetHandleInformation(reader, 1, 0))
          throw failure("SetHandleInformation");
        pipes.push({ handle: reader, kind: kind as "stdout" | "stderr" });
        return writer;
      }
      if (typeof mode === "number")
        throw new Error(`Windows ${kind} file descriptor requires ${kind}Path`);
      const source = k.GetStdHandle(id);
      if (!valid(source)) {
        const file = wide("NUL");
        return keep(
          k.CreateFileW(
            ptr(file),
            kind === "stdin" ? 0x80000000 : 0x40000000,
            7,
            ptr(security),
            3,
            0x80,
            0n,
          ),
          "CreateFileW",
        );
      }
      const duplicate = Buffer.alloc(8),
        current = k.GetCurrentProcess();
      if (!k.DuplicateHandle(current, source, current, ptr(duplicate), 0, 1, 2))
        throw failure("DuplicateHandle");
      return keep(handleAt(duplicate), "DuplicateHandle");
    };
    const handles = [
      standard("stdin", 0xfffffff6),
      standard("stdout", 0xfffffff5),
      standard("stderr", 0xfffffff4),
    ];
    const size = Buffer.alloc(8);
    k.InitializeProcThreadAttributeList(null, 1, 0, ptr(size));
    attributes = Buffer.alloc(Number(handleAt(size)));
    if (!k.InitializeProcThreadAttributeList(ptr(attributes), 1, 0, ptr(size)))
      throw failure("InitializeProcThreadAttributeList");
    attributesReady = true;
    const list = Buffer.alloc(24);
    handles.forEach((h, i) => setHandle(list, i * 8, h));
    if (
      !k.UpdateProcThreadAttribute(
        ptr(attributes),
        0,
        0x20002,
        ptr(list),
        list.length,
        null,
        null,
      )
    )
      throw failure("UpdateProcThreadAttribute");
    // STARTUPINFOEXW (64 bit): cb=112, dwFlags=60, stdio=80/88/96, attribute list=104.
    const startup = Buffer.alloc(112);
    view(startup).setUint32(0, 112, true);
    view(startup).setUint32(60, 0x100, true);
    handles.forEach((h, i) => setHandle(startup, 80 + i * 8, h));
    setHandle(startup, 104, ptr(attributes));
    const info = Buffer.alloc(24),
      flags =
        0x80000 |
        0x400 |
        (options.windowsHide === false ? 0 : 0x8000000) |
        (options.detached ? 0x200 : 0);
    if (
      !k.CreateProcessW(
        ptr(application),
        ptr(command),
        null,
        null,
        1,
        flags,
        ptr(environment),
        ptr(directory),
        ptr(startup),
        ptr(info),
      )
    )
      throw failure("CreateProcessW");
    processHandle = keep(handleAt(info), "CreateProcessW");
    const thread = keep(handleAt(info, 8), "CreateProcessW");
    const pid = view(info).getUint32(16, true);
    close(thread);
    handles.forEach(close);
    k.DeleteProcThreadAttributeList(ptr(attributes));
    attributesReady = false;
    if (capture) {
      const deadline = Date.now() + capture.timeoutMs,
        chunks: Buffer[] = [];
      let status = 258;
      while (status === 258 || pipes.some(({ handle }) => owned.has(handle))) {
        for (const { handle, kind } of pipes) {
          if (!owned.has(handle)) continue;
          const available = Buffer.alloc(4),
            read = Buffer.alloc(4);
          if (!k.PeekNamedPipe(handle, null, 0, null, ptr(available), null)) {
            const error = k.GetLastError();
            if (
              error !== 109 &&
              error !== 232 &&
              !(error === 0 && k.WaitForSingleObject(processHandle, 0) === 0)
            )
              throw new Error(`PeekNamedPipe failed (Windows error ${error})`);
            close(handle);
            continue;
          }
          const count = Math.min(view(available).getUint32(0, true), 65536);
          if (count) {
            const data = Buffer.alloc(count);
            if (!k.ReadFile(handle, ptr(data), count, ptr(read), null))
              throw failure("ReadFile");
            if (kind === "stdout")
              chunks.push(data.subarray(0, view(read).getUint32(0, true)));
          }
        }
        if (Date.now() > deadline)
          throw new Error("Windows process capture timed out");
        status = k.WaitForSingleObject(processHandle, 5);
        if (status !== 0 && status !== 258)
          throw failure("WaitForSingleObject");
      }
      const code = Buffer.alloc(4);
      if (!k.GetExitCodeProcess(processHandle, ptr(code)))
        throw failure("GetExitCodeProcess");
      close(processHandle);
      capture.text = Buffer.concat(chunks).toString("utf8");
      return {
        pid,
        stdout: null,
        stderr: null,
        exited: Promise.resolve(view(code).getUint32(0, true)),
        kill() {},
        unref() {},
      };
    }
    let complete = false;
    const timers: ReturnType<typeof setInterval>[] = [];
    const output: Record<
      "stdout" | "stderr",
      ReadableStream<Uint8Array> | null
    > = { stdout: null, stderr: null };
    for (const { handle, kind } of pipes) {
      let timer: ReturnType<typeof setInterval>;
      output[kind] = new ReadableStream<Uint8Array>({
        start(controller) {
          const available = Buffer.alloc(4),
            read = Buffer.alloc(4);
          timer = setInterval(() => {
            if (!owned.has(handle)) {
              clearInterval(timer);
              return;
            }
            if (!k.PeekNamedPipe(handle, null, 0, null, ptr(available), null)) {
              const code = k.GetLastError();
              clearInterval(timer);
              close(handle);
              // Bun's FFI may clear thread last-error between calls. A failed
              // peek after process exit also establishes EOF on this reader.
              if (
                code === 109 ||
                code === 232 ||
                (code === 0 &&
                  (complete || k.WaitForSingleObject(processHandle, 0) === 0))
              )
                controller.close();
              else
                controller.error(
                  new Error(`PeekNamedPipe failed (Windows error ${code})`),
                );
              return;
            }
            const count = Math.min(view(available).getUint32(0, true), 65536);
            if (!count || (controller.desiredSize ?? 1) <= 0) return;
            const data = Buffer.alloc(count);
            if (!k.ReadFile(handle, ptr(data), count, ptr(read), null)) {
              const error = failure("ReadFile");
              clearInterval(timer);
              close(handle);
              controller.error(error);
              return;
            }
            controller.enqueue(data.subarray(0, view(read).getUint32(0, true)));
          }, 10);
          timers.push(timer);
        },
        cancel() {
          clearInterval(timer);
          close(handle);
        },
      });
    }
    const exited = new Promise<number>((resolveExit, rejectExit) => {
      const timer = setInterval(() => {
        const status = k.WaitForSingleObject(processHandle, 0);
        if (status === 258) return;
        clearInterval(timer);
        complete = true;
        const code = Buffer.alloc(4);
        if (status !== 0 || !k.GetExitCodeProcess(processHandle, ptr(code))) {
          const error = failure("WaitForSingleObject/GetExitCodeProcess");
          close(processHandle);
          rejectExit(error);
          return;
        }
        close(processHandle);
        resolveExit(view(code).getUint32(0, true));
      }, 10);
      timers.push(timer);
    });
    return {
      pid,
      ...output,
      exited,
      kill() {
        if (!complete && !k.TerminateProcess(processHandle, 1))
          throw failure("TerminateProcess");
      },
      unref() {
        timers.forEach((t) => t.unref());
      },
    };
  } catch (error) {
    if (processHandle) k.TerminateProcess(processHandle, 1);
    if (attributes && attributesReady)
      k.DeleteProcThreadAttributeList(ptr(attributes));
    [...owned].forEach(close);
    throw error;
  }
}
/** Synchronous, whitelisted launcher for existing Windows process identity probes. */
export function windowsCaptureSync(argv: string[], timeoutMs = 8000): string {
  const capture = { timeoutMs, text: "" };
  spawnWindowsProcess(
    argv,
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    capture,
  );
  return capture.text;
}