function normalizeRecord(
  value: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key || /[=\0]/.test(key)) continue;
    if (raw === undefined || raw === null) continue;
    result[key] = String(raw);
  }
  return result;
}

export function parseEnvString(
  value: string | null | undefined,
): Record<string, string> {
  const text = String(value ?? "").trim();
  if (!text) return {};

  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeRecord(parsed as Record<string, unknown>);
      }
    } catch {}
  }

  const result: Record<string, string> = {};
  for (const part of text.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (!key || /[=\0]/.test(key)) continue;
    result[key] = part.slice(separator + 1).trim();
  }
  return result;
}

export function stringifyEnvString(value: Record<string, string>): string {
  return JSON.stringify(normalizeRecord(value));
}
