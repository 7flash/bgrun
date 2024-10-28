/**
 * GET /api/events — Server-Sent Events endpoint
 * 
 * Streams process data every 3 seconds. Replaces client-side polling.
 * The client connects once via EventSource and receives updates automatically.
 */
import { getAllProcesses } from '../../../../src/db';
import { calculateRuntime } from '../../../../src/utils';
import { getProcessBatchMemory } from '../../../../src/platform';
import { $ } from 'bun';

const INTERVAL_MS = 3_000;
const SUBPROCESS_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), SUBPROCESS_TIMEOUT_MS)),
    ]);
}

async function getRunningPids(pids: number[]): Promise<Set<number>> {
    if (pids.length === 0) return new Set();
    try {
        const isWin = process.platform === 'win32';
        if (isWin) {
            const result = await $`tasklist /FO CSV /NH`.nothrow().quiet().text();
            const runningPids = new Set<number>();
            for (const line of result.split('\n')) {
                const match = line.match(/"[^"]*","(\d+)"/);
                if (match) {
                    const pid = parseInt(match[1]);
                    if (pids.includes(pid)) runningPids.add(pid);
                }
            }
            return runningPids;
        } else {
            const result = await $`ps -p ${pids.join(',')} -o pid=`.nothrow().quiet().text();
            const runningPids = new Set<number>();
            for (const line of result.trim().split('\n')) {
                const pid = parseInt(line.trim());
                if (!isNaN(pid)) runningPids.add(pid);
            }
            return runningPids;
        }
    } catch {
        return new Set();
    }
}

async function getPortsByPid(pids: number[]): Promise<Map<number, number[]>> {
    const portMap = new Map<number, number[]>();
    if (pids.length === 0) return portMap;
    try {
        const isWin = process.platform === 'win32';
        if (isWin) {
            const result = await $`netstat -ano`.nothrow().quiet().text();
            const pidSet = new Set(pids);
            for (const line of result.split('\n')) {
                const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
                if (match) {
                    const port = parseInt(match[1]);
                    const pid = parseInt(match[2]);
                    if (pidSet.has(pid)) {
                        const existing = portMap.get(pid) || [];
                        if (!existing.includes(port)) existing.push(port);
                        portMap.set(pid, existing);
                    }
                }
            }
        }
    } catch { /* ignore */ }
    return portMap;
}

function getProcessGroup(envStr: string): string | null {
    if (!envStr) return null;
    const match = envStr.match(/(?:^|,)BGR_GROUP=([^,]+)/);
    return match ? match[1] : null;
}

async function fetchProcesses(): Promise<any[]> {
    const procs = getAllProcesses();
    const pids = procs.map((p: any) => p.pid);

    const [runningPids, portMap, memoryMap] = await Promise.all([
        withTimeout(getRunningPids(pids), new Set<number>()),
        withTimeout(getPortsByPid(pids), new Map<number, number[]>()),
        withTimeout(getProcessBatchMemory(pids), new Map<number, number>()),
    ]);

    return procs.map((p: any) => {
        const running = runningPids?.has(p.pid) ?? false;
        const ports = running ? (portMap?.get(p.pid) || []) : [];
        const memory = running ? (memoryMap?.get(p.pid) || 0) : 0;

        return {
            name: p.name,
            command: p.command,
            directory: p.workdir,
            pid: p.pid,
            running,
            port: ports.length > 0 ? ports[0] : null,
            ports,
            memory,
            group: getProcessGroup(p.env),
            runtime: calculateRuntime(p.timestamp),
            timestamp: p.timestamp,
        };
    });
}

export async function GET() {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            // Send initial data immediately
            try {
                const data = await fetchProcesses();
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
                controller.enqueue(encoder.encode(`data: []\n\n`));
            }

            // Then send updates every INTERVAL_MS
            const interval = setInterval(async () => {
                try {
                    const data = await fetchProcesses();
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Skip this tick, send on next
                }
            }, INTERVAL_MS);

            // Cleanup when client disconnects
            // Note: Bun's ReadableStream doesn't have a cancel callback in the same way,
            // but the interval will be garbage collected when the stream is closed
            const cleanup = () => clearInterval(interval);
            controller.enqueue(encoder.encode(`: keepalive\n\n`));

            // Store cleanup for when the stream is cancelled
            (stream as any).__cleanup = cleanup;
        },
        cancel() {
            if ((stream as any).__cleanup) {
                (stream as any).__cleanup();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        },
    });
}
