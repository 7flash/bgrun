/**
 * GET /api/processes — Enriched process list
 * 
 * Uses batch subprocess calls (single tasklist + single netstat)
 * instead of per-process calls to avoid subprocess pile-up on Windows.
 * Results are cached for 5 seconds via globalThis.
 */
import { getAllProcesses } from '../../../../src/db';
import { calculateRuntime } from '../../../../src/utils';
import { getProcessBatchMemory } from '../../../../src/platform';
import { measure, createMeasure } from 'measure-fn';
import { $ } from 'bun';

const api = createMeasure('api');

const CACHE_TTL_MS = 5_000;
const SUBPROCESS_TIMEOUT_MS = 4_000;

// Persistent cache across module re-evaluations
const g = globalThis as any;
if (!g.__bgrProcessCache) {
    g.__bgrProcessCache = { data: null, timestamp: 0, inflight: null };
}
const cache = g.__bgrProcessCache;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>(resolve => setTimeout(() => resolve(fallback), SUBPROCESS_TIMEOUT_MS)),
    ]);
}

/** Single tasklist call — returns set of running PIDs */
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

/** Single netstat call — returns map of PID → ports */
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
        } else {
            const result = await $`ss -tlnp`.nothrow().quiet().text();
            const pidSet = new Set(pids);
            for (const line of result.split('\n')) {
                for (const pid of pidSet) {
                    if (line.includes(`pid=${pid}`)) {
                        const portMatch = line.match(/:(\d+)\s/);
                        if (portMatch) {
                            const port = parseInt(portMatch[1]);
                            const existing = portMap.get(pid) || [];
                            if (!existing.includes(port)) existing.push(port);
                            portMap.set(pid, existing);
                        }
                    }
                }
            }
        }
    } catch { /* ignore */ }
    return portMap;
}

// Parse environment string to find BGR_GROUP
function getProcessGroup(envStr: string): string | null {
    if (!envStr) return null;
    // Env is usually "KEY=VAL,KEY2=VAL2"
    const match = envStr.match(/(?:^|,)BGR_GROUP=([^,]+)/);
    return match ? match[1] : null;
}

async function fetchProcesses(): Promise<any[]> {
    return await api.measure('Fetch processes', async (m) => {
        const procs = getAllProcesses();
        const pids = procs.map((p: any) => p.pid);

        // Three subprocess calls total (not 3×N)
        const [runningPids, portMap, memoryMap] = await Promise.all([
            m('Running PIDs', () => withTimeout(getRunningPids(pids), new Set<number>())),
            m('Port map', () => withTimeout(getPortsByPid(pids), new Map<number, number[]>())),
            m('Memory map', () => withTimeout(getProcessBatchMemory(pids), new Map<number, number>())),
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
                memory, // Bytes
                group: getProcessGroup(p.env),
                runtime: calculateRuntime(p.timestamp),
                timestamp: p.timestamp,
            };
        });
    }) ?? [];
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const bustCache = url.searchParams.has('t');
    const now = Date.now();

    // Return cached data if still fresh and no bust param
    if (!bustCache && cache.data && (now - cache.timestamp) < CACHE_TTL_MS) {
        return Response.json(cache.data);
    }

    // Deduplicate concurrent requests
    if (!cache.inflight) {
        cache.inflight = fetchProcesses().then(result => {
            cache.data = result;
            cache.timestamp = Date.now();
            cache.inflight = null;
            return result;
        }).catch(err => {
            cache.inflight = null;
            throw err;
        });
    }

    try {
        const result = await cache.inflight;
        return Response.json(result);
    } catch (err) {
        console.error('[api/processes] Error fetching processes:', err);
        return Response.json(cache.data ?? []);
    }
}
