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
