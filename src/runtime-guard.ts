export function isBunRuntime(): boolean {
  return typeof Bun !== "undefined";
}

export function describeRuntime(): string {
  if (typeof Bun !== "undefined") return `bun ${Bun.version}`;
  if (typeof process !== "undefined" && process.versions?.node) {
    return `node ${process.versions.node}`;
  }
  // Deno exposes globalThis.Deno. Avoid referencing the bare identifier
  // directly so this file remains safe in every JS runtime.
  const maybeDeno = (globalThis as Record<string, unknown>).Deno as
    | { version?: { deno?: string } }
    | undefined;
  if (maybeDeno?.version?.deno) return `deno ${maybeDeno.version.deno}`;
  return "unknown JavaScript runtime";
}

export function requireBunRuntime(): void {
  if (isBunRuntime()) return;
  throw new Error(
    `bgrun requires Bun runtime; current runtime is ${describeRuntime()}.`,
  );
}
