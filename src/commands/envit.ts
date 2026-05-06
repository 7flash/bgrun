import { loadConfigEnv } from "../config";
import { error } from "../logger";

export type EnvitShell = "powershell" | "cmd" | "sh" | "json";

export interface EnvitOptions {
    directory?: string;
    configPath?: string;
    shell?: EnvitShell;
}

export interface ParsedEnvitArgs extends EnvitOptions {
    help: boolean;
}

export function parseEnvitArgs(args: string[]): ParsedEnvitArgs {
    let directory: string | undefined;
    let configPath: string | undefined;
    let shell: EnvitShell | undefined;
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            help = true;
            continue;
        }

        if (arg === "--directory") {
            directory = args[++i];
            if (!directory) error("Missing value for --directory.");
            continue;
        }

        if (arg.startsWith("--directory=")) {
            directory = arg.slice("--directory=".length);
            if (!directory) error("Missing value for --directory.");
            continue;
        }

        if (arg === "--config") {
            configPath = args[++i];
            if (!configPath) error("Missing value for --config.");
            continue;
        }

        if (arg.startsWith("--config=")) {
            configPath = arg.slice("--config=".length);
            if (!configPath) error("Missing value for --config.");
            continue;
        }

        if (arg === "--shell") {
            const value = args[++i];
            if (!value) error("Missing value for --shell.");
            shell = normalizeEnvitShell(value);
            continue;
        }

        if (arg.startsWith("--shell=")) {
            shell = normalizeEnvitShell(arg.slice("--shell=".length));
            continue;
        }

        if (!configPath) {
            configPath = arg;
            continue;
        }

        error(`Unexpected argument '${arg}'. envit prints shell export commands and does not run a child process.`);
    }

    return { directory, configPath, shell, help };
}

function normalizeEnvitShell(value: string): EnvitShell {
    const normalized = value.trim().toLowerCase();
    if (normalized === "powershell" || normalized === "pwsh" || normalized === "ps1") return "powershell";
    if (normalized === "cmd" || normalized === "bat") return "cmd";
    if (normalized === "sh" || normalized === "bash" || normalized === "zsh") return "sh";
    if (normalized === "json") return "json";
    error(`Unsupported shell '${value}'. Use powershell, cmd, sh, or json.`);
}

function detectEnvitShell(): EnvitShell {
    if (process.platform === "win32") {
        return "powershell";
    }
    return "sh";
}

function escapePowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function escapeCmd(value: string): string {
    return value.replace(/"/g, '""');
}

function escapeSh(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function renderEnvitOutput(env: Record<string, string>, shell: EnvitShell): string {
    if (shell === "json") {
        return JSON.stringify(env, null, 2);
    }

    const lines = Object.entries(env).map(([key, value]) => {
        if (shell === "powershell") {
            return `$env:${key}=${escapePowerShell(value)}`;
        }
        if (shell === "cmd") {
            return `set "${key}=${escapeCmd(value)}"`;
        }
        return `export ${key}=${escapeSh(value)}`;
    });

    return lines.join("\n");
}

export async function handleEnvit(options: EnvitOptions): Promise<void> {
    const cwd = options.directory || process.cwd();
    const configPath = options.configPath || ".config.toml";
    const shell = options.shell || detectEnvitShell();

    const { configEnv, exists } = await loadConfigEnv(cwd, configPath);
    if (!exists) {
        error(`Config file '${configPath}' not found.`);
    }

    console.log(renderEnvitOutput(configEnv, shell));
}
