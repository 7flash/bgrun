import { describe, expect, test } from "bun:test";
import { isInteractiveTop } from "./top";

describe("isInteractiveTop", () => {
  test("uses an interactive screen only for a TTY", () => {
    expect(isInteractiveTop({}, true)).toBe(true);
    expect(isInteractiveTop({}, false)).toBe(false);
    expect(isInteractiveTop({}, undefined)).toBe(false);
  });

  test("--once and JSON are never interactive", () => {
    expect(isInteractiveTop({ once: true }, true)).toBe(false);
    expect(isInteractiveTop({ json: true }, true)).toBe(false);
  });
});
