export type CliValues = Record<string, unknown>;

export function shouldUseTop(
  positionals: string[],
  values: CliValues,
): boolean {
  return Boolean(
    positionals[0] === "top" ||
    values.top ||
    values.cpu ||
    values.memory ||
    values.ports ||
    values.system ||
    values.once ||
    values.interval !== undefined ||
    values.limit !== undefined,
  );
}
