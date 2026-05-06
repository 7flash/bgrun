import { getProcess } from "./db";

const MONTH_NAMES = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

const DAY_NAMES = [
    "",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
    "twentieth",
    "twenty-first",
    "twenty-second",
    "twenty-third",
    "twenty-fourth",
    "twenty-fifth",
    "twenty-sixth",
    "twenty-seventh",
    "twenty-eighth",
    "twenty-ninth",
    "thirtieth",
    "thirty-first",
];

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

export function buildDateProcessName(now = new Date()): string {
    const month = MONTH_NAMES[now.getMonth()] || "process";
    const day = DAY_NAMES[now.getDate()] || "day";
    return `${month}-${day}`;
}

export function generateAutoProcessName(now = new Date()): string {
    const baseName = buildDateProcessName(now);
    if (!getProcess(baseName)) {
        return baseName;
    }

    const timeSuffix = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const timeName = `${baseName}-${timeSuffix}`;
    if (!getProcess(timeName)) {
        return timeName;
    }

    for (let i = 1; i < 1000; i++) {
        const candidate = `${timeName}-${i}`;
        if (!getProcess(candidate)) {
            return candidate;
        }
    }

    return `${timeName}-${Date.now()}`;
}

export function shellQuoteArg(arg: string): string {
    if (process.platform === "win32") {
        if (/^[A-Za-z0-9_./:-]+$/.test(arg)) return arg;
        return `"${arg.replace(/"/g, '\\"')}"`;
    }

    if (/^[A-Za-z0-9_./:-]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function joinCommandArgs(args: string[]): string {
    return args.map(shellQuoteArg).join(" ");
}
