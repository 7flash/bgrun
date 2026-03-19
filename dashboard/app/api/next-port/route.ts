/**
 * GET /api/next-port — Find the next available port
 * 
 * Scans existing processes' env for PORT= values,
 * then returns the next unused port starting from a base (default 3001).
 */
import { getAllProcesses } from '../../../../src/db';

export async function GET(req: Request) {
    const url = new URL(req.url);
    const base = parseInt(url.searchParams.get('base') || '3001') || 3001;

    const processes = getAllProcesses();
    const usedPorts = new Set<number>();

    for (const proc of processes) {
        // Parse PORT from env string (comma-separated KEY=VAL)
        const envStr = proc.env || '';
        const portMatch = envStr.match(/(?:^|,)PORT=(\d+)/);
        if (portMatch) {
            usedPorts.add(parseInt(portMatch[1]));
        }
    }

    // Find next available port
    let nextPort = base;
    while (usedPorts.has(nextPort)) {
        nextPort++;
    }

    return Response.json({ port: nextPort, usedPorts: Array.from(usedPorts).sort((a, b) => a - b) });
}
