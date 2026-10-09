# Windows handle inheritance fix

Windows launches now call CreateProcessW directly through Bun FFI. STARTUPINFOEXW and PROC_THREAD_ATTRIBUTE_HANDLE_LIST whitelist only the explicit stdin, stdout, and stderr handles. Parent sockets, database handles, and other inheritable resources are excluded. Each launch owns its duplicated handles and closes them on failure or completion; it does not change inheritance flags on shared parent handles.

The path covers managed workers, guards/watchers, dashboard and inline launches, Windows probes, and deployment helpers. Standard streams support ignored/inherited handles, append log files, and asynchronously drained pipes. Existing Windows process birth identity strings are preserved with a synchronous whitelisted probe. Other platforms retain Bun.spawn.

## Verification on Windows x64

- Bun 1.3.14 raw-spawn baseline reproduced EADDRINUSE after the web exited with its worker still alive.
- Both IPv4 and IPv6 acceptance tests passed: three concurrent managed workers retained their PIDs and continued stdout/stderr logging through three immediate same-port web restarts.
- An intentionally inheritable signaled event reached a raw Bun.spawn child, but the whitelisted child could not access it.
- Native-launch tests covered argument quoting, Unicode environments, large simultaneous stdout/stderr output, append logging through cmd.exe, synchronous capture timeouts, and invalid launch inputs.
- Final focused verification passed 13 tests / 140 assertions. Startup-failure log regression passed separately. Production build and declaration generation passed.
- Bun 1.3.10 minimum-version smoke checks passed native spawning, piped output, exit status, and legacy Windows process identity.

Full repository checks are not clean: typecheck reports three unchanged errors in bgrun.test.ts and fast-json-doctor.test-snippet.ts. Broad tests include existing JSON-environment expectations, shared environment contamination, SQLite cleanup/migration issues, and a configuration fixture command-identity mismatch. These remain outside this fix.

Windows FFI is still described as experimental by Bun. This implementation uses the documented Windows API directly and has been verified on Windows x64; Windows ARM64 and Unix execution were not available for full runtime verification in this session.

References: [Microsoft handle inheritance](https://learn.microsoft.com/en-us/windows/win32/procthread/creating-processes), [handle whitelist requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute), [Bun FFI](https://bun.com/docs/runtime/ffi).