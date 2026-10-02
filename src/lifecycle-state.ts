export class ProcessMonitoringSetupError extends Error {
  readonly processName: string;
  readonly pid: number;
  override readonly cause: unknown;

  constructor(name: string, pid: number, cause: unknown) {
    super(
      `Process '${name}' started with PID ${pid}, but monitoring setup failed`,
      {
        cause,
      },
    );
    this.name = "ProcessMonitoringSetupError";
    this.processName = name;
    this.pid = pid;
    this.cause = cause;
  }
}
