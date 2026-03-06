import { getAllProcesses, updateProcessPid } from '../../../../src/db';
import { calculateRuntime } from '../../../../src/utils';
import { getProcessBatchResources, reconcileProcessPids } from '../../../../src/platform';
import { guardRestartCounts } from '../../../../src/server';
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
if (!g.__bgrResourceHistory) {
    // Map of process name -> { memory: number[], cpu: number[], lastCpuTime: number, lastCheck: number }
    g.__bgrResourceHistory = new Map<string, { memory: number[], cpu: number[], lastCpuTime: number, lastCheck: number }>();
}
const cache = g.__bgrProcessCache;
const history = g.__bgrResourceHistory;

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
        let [runningPids, portMap, resourceMap] = await Promise.all([
            m('Running PIDs', () => withTimeout(getRunningPids(pids), new Set<number>())),
            m('Port map', () => withTimeout(getPortsByPid(pids), new Map<number, number[]>())),
            m('Resource map', () => withTimeout(getProcessBatchResources(pids), new Map<number, { memory: number, cpu: number }>())),
        ]);

        // PID reconciliation: if stored PIDs are dead, try to find the real process
        const allPids = new Set(pids);
        const deadPids = new Set(pids.filter((pid: number) => !runningPids?.has(pid)));

        if (deadPids.size > 0) {
            const reconciled = await m('Reconcile dead PIDs', () =>
                withTimeout(reconcileProcessPids(procs, deadPids), new Map<string, number>())
            );

            if (reconciled && reconciled.size > 0) {
                // Update stored PIDs in DB and refresh running status
                const newPids: number[] = [];
                for (const [name, newPid] of reconciled) {
                    updateProcessPid(name, newPid);
                    newPids.push(newPid);
                    // Update the proc object in-place so the response uses the new PID
                    const proc = procs.find((p: any) => p.name === name);
                    if (proc) proc.pid = newPid;
                }

                // Mark reconciled PIDs as running
                if (!runningPids) runningPids = new Set();
                for (const pid of newPids) runningPids.add(pid);

                // Re-fetch ports and resources for the new PIDs
                const [newPorts, newResources] = await Promise.all([
                    withTimeout(getPortsByPid(newPids), new Map<number, number[]>()),
                    withTimeout(getProcessBatchResources(newPids), new Map<number, { memory: number, cpu: number }>()),
                ]);
                if (!portMap) portMap = new Map();
                if (!resourceMap) resourceMap = new Map();
                for (const [pid, ports] of newPorts) portMap.set(pid, ports);
                for (const [pid, res] of newResources) resourceMap.set(pid, res);
            }
        }

        const now = Date.now();
        const isWin = process.platform === 'win32';

        return procs.map((p: any) => {
            const running = runningPids?.has(p.pid) ?? false;
            const ports = running ? (portMap?.get(p.pid) || []) : [];
            const res = running ? (resourceMap?.get(p.pid) || { memory: 0, cpu: 0 }) : { memory: 0, cpu: 0 };

            // Manage history tracking for sparklines (up to 60 points = 5 minutes at 5s polling)
            let h = history.get(p.name);
            if (!h) {
                h = { memory: [], cpu: [], lastCpuTime: 0, lastCheck: 0 };
                history.set(p.name, h);
            }

            let cpuPercent = 0;
            if (running) {
                if (isWin) {
                    // Windows: cpu is cumulative seconds. Calculate delta percentage across time.
                    if (h.lastCheck > 0 && h.lastCpuTime > 0) {
                        const timeDeltaSec = (now - h.lastCheck) / 1000;
                        const cpuDeltaSec = res.cpu - h.lastCpuTime;
                        if (timeDeltaSec > 0 && cpuDeltaSec >= 0) {
                            // Max it at 100% per core? We'll just display the total usage
                            cpuPercent = (cpuDeltaSec / timeDeltaSec) * 100;
                        }
                    }
                    h.lastCpuTime = res.cpu;
                } else {
                    // Unix: it's already a percentage from \`ps\`
                    cpuPercent = res.cpu;
                }

                // Add points
                h.memory.push(res.memory);
                h.cpu.push(cpuPercent);
                if (h.memory.length > 60) h.memory.shift();
                if (h.cpu.length > 60) h.cpu.shift();
            } else {
                // Not running, push zeros if not already zeroed out to bring graphs down
                if (h.memory.length > 0 && h.memory[h.memory.length - 1] !== 0) {
                    h.memory.push(0);
                    h.cpu.push(0);
                    if (h.memory.length > 60) h.memory.shift();
                    if (h.cpu.length > 60) h.cpu.shift();
                }
                h.lastCheck = 0;
                h.lastCpuTime = 0;
            }

            if (running) h.lastCheck = now;

            return {
                name: p.name,
                command: p.command,
                directory: p.workdir,
                pid: p.pid,
                running,
                port: ports.length > 0 ? ports[0] : null,
                ports,
                memory: res.memory, // Bytes
                cpu: cpuPercent, // Percentage
                memoryHistory: [...h.memory],
                cpuHistory: [...h.cpu],
                group: getProcessGroup(p.env),
                runtime: calculateRuntime(p.timestamp),
                timestamp: p.timestamp,
                env: p.env || '',
                configPath: p.configPath || '',
                stdoutPath: p.stdout_path || '',
                stderrPath: p.stderr_path || '',
                guardRestarts: guardRestartCounts.get(p.name) || 0,
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
