import { describe, expect, test } from "bun:test";
import { formatShortRuntime } from "./process-snapshot";

describe("formatShortRuntime", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z");

  test("keeps common runtimes compact", () => {
    expect(formatShortRuntime("2026-09-29T11:59:45.000Z", now)).toBe("<1m");
    expect(formatShortRuntime("2026-09-29T11:13:00.000Z", now)).toBe("47m");
    expect(formatShortRuntime("2026-09-29T09:46:00.000Z", now)).toBe("2h 14m");
    expect(formatShortRuntime("2026-09-26T10:00:00.000Z", now)).toBe("3d 2h");
  });
});
