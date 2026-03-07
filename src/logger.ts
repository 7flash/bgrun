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

export function error(message: string | Error) {
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
    process.exit(1);
}
