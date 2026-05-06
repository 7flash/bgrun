import { buildManagedProcessEnv } from "../utils";
import { loadConfigEnv } from "../config";
import { error } from "../logger";

export interface InlineOptions {
    directory?: string;
    configPath?: string;
    commandArgs: string[];
}

export interface ParsedInlineArgs extends InlineOptions {
    help: boolean;
}

export function parseInlineArgs(args: string[]): ParsedInlineArgs {
    let directory: string | undefined;
    let configPath: string | undefined;
    let help = false;
    const commandArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (commandArgs.length > 0) {
            commandArgs.push(arg);
            continue;
        }

        if (arg === "--") {
            commandArgs.push(...args.slice(i + 1));
            break;
        }

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

        commandArgs.push(...args.slice(i));
        break;
    }

    return { directory, configPath, commandArgs, help };
}

export async function handleInline(options: InlineOptions): Promise<never> {
    const cwd = options.directory || process.cwd();
    const configPath = options.configPath || ".config.toml";

    const { configEnv, exists } = await loadConfigEnv(cwd, configPath);
    if (exists) {
        console.log(`Loaded config from ${configPath}`);
    } else {
        console.log(`Config file '${configPath}' not found, continuing without it.`);
    }

    if (options.commandArgs.length === 0) {
        error("Please provide a command to run. Example: bgrun inline -- bun run dev");
    }

    const proc = Bun.spawn(options.commandArgs, {
        cwd,
        env: buildManagedProcessEnv(
            Bun.env as Record<string, string | undefined>,
            configEnv,
        ),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

    const exitCode = await proc.exited;
    process.exit(exitCode);
}
