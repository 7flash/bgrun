import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "..", "dashboard", "app", "page.client.tsx"),
  "utf8",
);

describe("dashboard client JSX rendering", () => {
  test("materializes Melina VNodes before DOM insertion", () => {
    expect(source).toContain('import { render } from "melina/client"');
    expect(source).toContain("function materialize");
    expect(source).toContain("function replaceRenderedChildren");
  });

  test("does not lie to TypeScript by casting VNodes to DOM nodes", () => {
    expect(source).not.toContain("as unknown as Node");
    expect(source).not.toContain("as unknown as HTMLElement");
  });

  test("all child replacement goes through the render-aware helper", () => {
    const directReplaceCalls = source.match(/\.replaceChildren\(/g) ?? [];
    expect(directReplaceCalls.length).toBe(1);
    expect(source).toContain("container.replaceChildren(...nodes)");
  });
});
