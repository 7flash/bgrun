import { basename, resolve } from "path";
import { getProcess } from "./db";

function sanitizeProcessName(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-._]+|[-._]+$/g, "");

    return normalized || "process";
}

export function buildDirectoryProcessName(directory: string): string {
    const resolved = resolve(directory);
    const folderName = basename(resolved);
    return sanitizeProcessName(folderName);
}

/**
 * Generate a process name from a command string.
 * Extracts meaningful parts like script names, tool names, etc.
 */
export function buildCommandProcessName(command: string): string {
    const parts = command.trim().split(/\s+/);

    // Skip runtime commands (bun, node, python, etc.)
    let startIndex = 0;
    const RUNTIME_COMMANDS = ['bun', 'node', 'npm', 'pnpm', 'yarn', 'python', 'python3', 'deno', 'ts-node'];
    if (RUNTIME_COMMANDS.includes(parts[0])) {
        startIndex++;
    }

    // Skip 'run', 'test', 'dev', 'start' commands
    const SUBCOMMANDS = ['run', 'test', 'dev', 'start', 'exec', 'x'];
    if (parts[startIndex] && SUBCOMMANDS.includes(parts[startIndex])) {
        startIndex++;
    }

    // Get the next meaningful part
    if (startIndex < parts.length) {
        const scriptPart = parts[startIndex];
        // Handle script:name format
        if (scriptPart.includes(':')) {
            const afterColon = scriptPart.split(':')[1];
            if (afterColon) {
                return sanitizeProcessName(afterColon);
            }
        }
        // Handle file.ts or file.js
        if (scriptPart.match(/\.(ts|js|tsx|jsx|mjs|cjs)$/)) {
            return sanitizeProcessName(scriptPart.replace(/\.(ts|js|tsx|jsx|mjs|cjs)$/, ''));
        }
        return sanitizeProcessName(scriptPart);
    }

    // Fallback to first part after runtime
    if (startIndex < parts.length && startIndex > 0) {
        return sanitizeProcessName(parts[startIndex]);
    }

    return "process";
}

export function generateAutoProcessName(directory: string): string {
    const baseName = buildDirectoryProcessName(directory);
    if (!getProcess(baseName)) {
        return baseName;
    }

    for (let i = 1; i < 1000; i++) {
        const candidate = `${baseName}-${i}`;
        if (!getProcess(candidate)) {
            return candidate;
        }
    }

    return `${baseName}-${Date.now()}`;
}

/**
 * Generate a unique process name based on the command.
 * Returns a name derived from the command, with a number suffix if needed.
 */
export function generateCommandBasedProcessName(command: string): string {
    const baseName = buildCommandProcessName(command);
    if (!getProcess(baseName)) {
        return baseName;
    }

    for (let i = 1; i < 1000; i++) {
        const candidate = `${baseName}-${i}`;
        if (!getProcess(candidate)) {
            return candidate;
        }
    }

    return `${baseName}-${Date.now()}`;
}

export function shellQuoteArg(arg: string): string {
    if (process.platform === "win32") {
        if (/^[A-Za-z0-9_./:\\-]+$/.test(arg)) return arg;
        return `"${arg.replace(/"/g, '\\"')}"`;
    }

    if (/^[A-Za-z0-9_./:-]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function joinCommandArgs(args: string[]): string {
    return args.map(shellQuoteArg).join(" ");
}
