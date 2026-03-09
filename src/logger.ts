import boxen from "boxen";
import chalk from "chalk";

export function announce(message: string, title?: string) {
    console.log(
        boxen(message, {
            padding: 1,
            margin: 1,
            borderColor: 'green',
            title: title || "bgrun",
            titleAlignment: 'center',
            borderStyle: 'round'
        })
    );
}

/** Custom error class so callers can distinguish bgrun errors from unexpected ones */
export class BgrunError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BgrunError';
    }
}

export function error(message: string | Error): never {
    const text = message instanceof Error ? (message.stack || message.message) : String(message);
    console.error(
        boxen(chalk.red(text), {
            padding: 1,
            margin: 1,
            borderColor: 'red',
            title: "Error",
            titleAlignment: 'center',
            borderStyle: 'double'
        })
    );
    // Throw instead of process.exit() — lets dashboard API handlers catch gracefully
    // CLI entry point has a top-level catch that calls process.exit(1)
    throw new BgrunError(text);
}
