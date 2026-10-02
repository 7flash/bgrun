import { getProcessBirthId } from "./process-identity";

export type OwnedChild = {
  pid: number;
  exited?: Promise<number>;
  kill?: (signal?: number | string) => unknown;
  unref(): void;
};

async function waitBrieflyForExit(child: OwnedChild): Promise<void> {
  if (!child.exited) return;
  await Promise.race([
    child.exited.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => setTimeout(resolve, 1000)),
  ]);
}

export async function cleanupOwnedChild(
  child: OwnedChild,
  birth: string,
  terminate: (
    pid: number,
    force?: boolean,
    startIdentity?: string,
  ) => Promise<void>,
): Promise<void> {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return;

  if (birth) {
    const current = getProcessBirthId(child.pid);
    if (!current || current !== birth) return;
    await terminate(child.pid, true, birth);
    return;
  }

  if (!child.kill) {
    throw new Error(
      `Cannot safely clean up locally-owned PID ${child.pid}: no birth identity or child handle kill method`,
    );
  }

  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }
  await waitBrieflyForExit(child);
}
