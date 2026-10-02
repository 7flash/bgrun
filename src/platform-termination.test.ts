import { describe, expect, test } from "bun:test";
import { selectTerminableDescendants } from "./platform";

describe("registered process tree protection", () => {
  test("skips a registered PID and its entire subtree", () => {
    const tree = new Map([
      [2, 1],
      [3, 2],
      [4, 1],
      [5, 4],
      [6, 5],
    ]);

    expect(selectTerminableDescendants(1, tree, new Set([4]))).toEqual([3, 2]);
  });

  test("returns descendants leaf-first", () => {
    const tree = new Map([
      [11, 10],
      [12, 11],
      [13, 10],
    ]);
    expect(selectTerminableDescendants(10, tree, new Set())).toEqual([
      12, 11, 13,
    ]);
  });
});
