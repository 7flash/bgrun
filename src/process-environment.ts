import { parseEnvString, stringifyEnvString } from "./env";
type EnvironmentRecord = {
  env: string;
  env_sources?: string | null;
};
type EnvironmentSources = {
  version: 1;
  defaults: Record<string, string>;
  legacy: Record<string, string>;
  overrides: Record<string, string>;
  removed: string[];
};
function readLayer(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid environment source layer");
  }
  const env = Object.fromEntries(Object.entries(value)) as Record<
    string,
    string
  >;
  stringifyEnvString(env);
  return env;
}
export function readEnvironmentSources(
  record?: EnvironmentRecord | null,
): EnvironmentSources {
  if (!record?.env_sources) {
    return {
      version: 1,
      defaults: {},
      legacy: record ? parseEnvString(record.env) : {},
      overrides: {},
      removed: [],
    };
  }
  const sources = JSON.parse(record.env_sources);
  if (
    !sources ||
    sources.version !== 1 ||
    !Array.isArray(sources.removed) ||
    sources.removed.some(
      (key: unknown) => typeof key !== "string" || !key || /[=\0]/.test(key),
    )
  ) {
    throw new Error("Invalid environment source metadata");
  }
  return {
    version: 1,
    defaults: readLayer(sources.defaults),
    legacy: readLayer(sources.legacy),
    overrides: readLayer(sources.overrides),
    removed: [...new Set<string>(sources.removed)],
  };
}
export function resolveProcessEnvironment(
  record: EnvironmentRecord | null,
  configuration: Record<string, string>,
  overrides: Record<string, string> | undefined,
  defaults: Record<string, string> = {},
): {
  env: Record<string, string>;
  sources: EnvironmentSources;
} {
  const sources = readEnvironmentSources(record);
  if (!record) sources.defaults = readLayer(defaults);
  if (overrides !== undefined) {
    sources.overrides = readLayer(overrides);
    sources.legacy = {};
    sources.removed = [];
  }
  const env = {
    ...sources.defaults,
    ...sources.legacy,
    ...configuration,
    ...sources.overrides,
  };
  for (const key of sources.removed) delete env[key];
  stringifyEnvString(env);
  return { env, sources };
}
export function updateEnvironmentSources(
  record: EnvironmentRecord,
  next: Record<string, string>,
): string {
  stringifyEnvString(next);
  const previous = parseEnvString(record.env);
  const sources = readEnvironmentSources(record);
  const removed = new Set(sources.removed);
  for (const key of Object.keys(previous)) {
    if (!Object.hasOwn(next, key)) {
      delete sources.overrides[key];
      removed.add(key);
    }
  }
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(previous, key) || previous[key] !== value) {
      Object.defineProperty(sources.overrides, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      removed.delete(key);
    }
  }
  sources.removed = [...removed];
  return JSON.stringify(sources);
}
