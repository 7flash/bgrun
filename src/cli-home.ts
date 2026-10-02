import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseConfigFile } from "./config";

function explicitHome(rawArgs: string[]): string | undefined {
  const inline = rawArgs.find((arg) => arg.startsWith("--home="));
  if (inline) return inline.slice("--home=".length).trim() || undefined;
  const index = rawArgs.indexOf("--home");
  return index >= 0 ? rawArgs[index + 1]?.trim() || undefined : undefined;
}

export async function resolveCliHome(
  rawArgs: string[],
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  const requested = explicitHome(rawArgs);
  if (requested) return resolve(cwd, requested);
  if (env.BGRUN_HOME?.trim()) return undefined;

  const configPath = resolve(cwd, ".config.toml");
  if (!existsSync(configPath)) return undefined;
  const config = await parseConfigFile(configPath);
  const localHome = config.BGR_LOCAL_HOME?.trim();
  return localHome ? resolve(cwd, localHome) : undefined;
}
