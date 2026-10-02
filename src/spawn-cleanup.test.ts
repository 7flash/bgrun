import { describe, expect, test } from "bun:test";
import { cleanupOwnedChild } from "./spawn-cleanup";

describe("owned child cleanup", () => {
  test("uses the owned child handle when no birth identity is available", async () => {
    let killed = false;
    let terminateCalls = 0;
    let finishExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      finishExit = resolve;
    });

    await cleanupOwnedChild(
      {
        pid: 12345,
        exited,
        kill() {
          killed = true;
          finishExit(137);
        },
        unref() {},
      },
      "",
      async () => {
        terminateCalls++;
      },
    );

    expect(killed).toBe(true);
    expect(terminateCalls).toBe(0);
  });
});
