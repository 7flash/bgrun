type ProcessLike = { name: string; timestamp?: string; id?: number };

function isNewer<T extends ProcessLike>(candidate: T, current: T): boolean {
  const byTimestamp = String(candidate.timestamp ?? "").localeCompare(
    String(current.timestamp ?? ""),
  );
  if (byTimestamp !== 0) return byTimestamp > 0;
  return Number(candidate.id ?? 0) > Number(current.id ?? 0);
}

export function selectLatestByName<T extends ProcessLike>(
  rows: readonly T[],
): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.name);
    if (!current || isNewer(row, current)) latest.set(row.name, row);
  }
  return [...latest.values()];
}
