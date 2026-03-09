
export function parseEnvString(envString: string): Record<string, string> {
    const env: Record<string, string> = {};
    envString.split(",").forEach(pair => {
        const [key, value] = pair.split("=");
        if (key && value) env[key] = value;
    });
    return env;
}


export function calculateRuntime(startTime: string): string {
    const start = new Date(startTime).getTime();
    const now = new Date().getTime();
    const diffInMinutes = Math.floor((now - start) / (1000 * 60));
    return `${diffInMinutes} minutes`;
}

// Re-export platform utils for backward compatibility and convenience
export { isProcessRunning } from "./platform";

import * as fs from "fs";
import chalk from "chalk";

// Read version at runtime instead of using macros (macros crash on Windows)
export async function getVersion(): Promise<string> {
    try {
        const { join } = await import("path");
        const pkgPath = join(import.meta.dir, '../package.json');
        const pkg = await Bun.file(pkgPath).json();
        return pkg.version || '0.0.0';
    } catch {
        return '0.0.0';
    }
}


export function validateDirectory(directory: string) {
    if (!directory || !fs.existsSync(directory)) {
        // Throw instead of process.exit() — lets dashboard API handlers catch gracefully
        throw new Error(`Directory not found or invalid: '${directory}'`);
    }
}

export function tailFile(path: string, prefix: string, colorFn: (s: string) => string, lines?: number): () => void {
    let position = 0;
    let lastPartial = '';

    if (!fs.existsSync(path)) {
        return () => { };
    }

    const fd = fs.openSync(path, 'r');

    const printNewContent = () => {
        try {
            const stats = fs.statSync(path);
            if (stats.size <= position) return;

            const buffer = Buffer.alloc(stats.size - position);
            fs.readSync(fd, buffer, 0, buffer.length, position);

            let content = buffer.toString();
            content = lastPartial + content;
            lastPartial = '';

            const lineArray = content.split(/\r?\n/);
            if (!content.endsWith('\n')) {
                lastPartial = lineArray.pop() || '';
            }

            lineArray.forEach(line => {
                if (line) {
                    console.log(colorFn(prefix + line));
                }
            });

            position = stats.size;
        } catch (e) {
            // ignore read errors
        }
    };

    const watcher = fs.watch(path, { persistent: true }, (event) => {
        if (event === 'change') {
            printNewContent();
        }
    });

    printNewContent(); // Check immediately

    return () => {
        watcher.close();
        try { fs.closeSync(fd); } catch { }
    };
}
