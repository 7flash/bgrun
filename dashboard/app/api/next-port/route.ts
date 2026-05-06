/**
 * GET /api/next-port — Find the next available port
 * 
 * Scans existing processes' env for PORT= values,
 * then returns the next unused port starting from a base (default 3001).
 */
import { getAllProcesses, parseCommandEnv } from '../../../lib/runtime';

export async function GET(req: Request) {
    const url = new URL(req.url);
    const base = parseInt(url.searchParams.get('base') || '3001') || 3001;

    const processes = getAllProcesses();
    const usedPorts = new Set<number>();

    for (const proc of processes) {
        // Parse PORT/BUN_PORT from both stored env and inline command env.
        const envStr = proc.env || '';
        const storedPortMatch = envStr.match(/(?:^|,)(?:PORT|BUN_PORT)=(\d+)/);
        if (storedPortMatch) {
            usedPorts.add(parseInt(storedPortMatch[1]));
        }

        const commandEnv = parseCommandEnv(proc.command || '');
        const commandPort = parseInt(commandEnv.PORT || commandEnv.BUN_PORT || '', 10);
        if (!isNaN(commandPort) && commandPort > 0) {
            usedPorts.add(commandPort);
        }
    }

    // Find next available port, skipping both registered and actually-bound ports
    let nextPort = base;
    while (usedPorts.has(nextPort) || await isPortInUse(nextPort)) {
        nextPort++;
    }

    return Response.json({ port: nextPort, usedPorts: Array.from(usedPorts).sort((a, b) => a - b) });
}

async function isPortInUse(port: number): Promise<boolean> {
    try {
        const server = Bun.serve({
            port,
            hostname: '127.0.0.1',
            fetch() { return new Response(''); },
        });
        server.stop(true);
        return false;
    } catch {
        return true;
    }
}
