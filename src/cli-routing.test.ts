import { describe, expect, test } from "bun:test";
import { shouldUseTop } from "./cli-routing";

describe("shouldUseTop", () => {
  test("keeps bare invocation in the normal list", () => {
    expect(shouldUseTop([], {})).toBe(false);
  });

  test("top positional selects resource monitor", () => {
    expect(shouldUseTop(["top"], {})).toBe(true);
  });

  test("--top selects resource monitor", () => {
    expect(shouldUseTop([], { top: true })).toBe(true);
  });

  test("resource flags imply top", () => {
    expect(shouldUseTop([], { cpu: true })).toBe(true);
    expect(shouldUseTop([], { memory: true })).toBe(true);
    expect(shouldUseTop([], { ports: true })).toBe(true);
    expect(shouldUseTop([], { system: true })).toBe(true);
    expect(shouldUseTop([], { cpu: true, system: true })).toBe(true);
  });

  test("top-only controls imply top", () => {
    expect(shouldUseTop([], { once: true })).toBe(true);
    expect(shouldUseTop([], { interval: "1" })).toBe(true);
    expect(shouldUseTop([], { limit: "20" })).toBe(true);
  });

  test("normal list filter does not imply top", () => {
    expect(shouldUseTop([], { filter: "prod" })).toBe(false);
  });
});
