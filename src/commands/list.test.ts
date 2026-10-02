import { describe, expect, test } from "bun:test";
import { formatProcessLine } from "./list";

describe("process list output", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z");

  test("formats a running process as one compact line", () => {
    expect(
      formatProcessLine(
        {
          name: "api",
          state: "running",
          pid: 1234,
          ports: [3000, 3001],
          startedAt: "2026-09-29T09:46:00.000Z",
        },
        now,
      ),
    ).toBe("api  ● running  pid 1234  :3000 :3001  2h 14m");
  });

  test("does not show stale pid, ports, or runtime for stopped processes", () => {
    expect(
      formatProcessLine(
        {
          name: "worker",
          state: "stopped",
          pid: null,
          ports: [],
          startedAt: "2026-09-29T09:46:00.000Z",
        },
        now,
      ),
    ).toBe("worker  ○ stopped");
  });
  test("omits absent ports instead of printing placeholders", () => {
    expect(
      formatProcessLine(
        {
          name: "worker",
          state: "running",
          pid: 5678,
          ports: [],
          startedAt: "2026-09-29T11:13:00.000Z",
        },
        now,
      ),
    ).toBe("worker  ● running  pid 5678  47m");
  });
});
