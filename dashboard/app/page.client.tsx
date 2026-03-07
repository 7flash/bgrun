/** @jsxImportSource melina/client */
/**
 * bgrun Dashboard — Page Client Interactivity
 *
 * NOT a React component. A mount function that adds interactivity
 * to the server-rendered HTML. JSX here creates real DOM elements
 * (via Melina's jsx-dom runtime, not React virtual DOM).
 *
 * Log viewer uses Melina's VDOM render() with keyed reconciler
 * for efficient incremental DOM updates.
 */
import { render as melinaRender, createElement as h, setReconciler } from 'melina/client/render';

interface ProcessData {
    name: string;
    pid: number;
    running: boolean;
    port: string;
    command: string;
    memory: number;
    runtime: number;
    directory: string;
    group?: string;
    timestamp: string;
    env: string;
    configPath: string;
    stdoutPath: string;
    stderrPath: string;
    guardRestarts: number;
    cpu?: number;
    cpuHistory?: number[];
    memoryHistory?: number[];
}

// ─── SVG Icon Helpers ───

function SvgIcon({ d, className }: { d: string; className?: string }) {
    return (
        <svg className={className || ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
        </svg>
    );
}

function LogsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
    );
}

function StopIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}

function RestartIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
    );
}

function DeployIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
    );
}

function ShieldIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    );
}

// ─── Sparkline Component ───
function MiniSparkline({ data, height = 24, stroke = "var(--text-accent)" }: { data: number[], height?: number, stroke?: string }) {
    if (!data || data.length < 2) return <svg className="sparkline" viewBox="0 0 100 24" height={height} width="60" />;

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0); // anchor to 0 minimum
    const range = max - min || 1;
    const padding = 2; // top/bottom pixel padding

    // Normalize path across 100 viewBox width
    const path = data.map((val, i) => {
        const x = (i / (data.length - 1)) * 100;
        const normalizedY = ((val - min) / range);
        const y = padding + (1 - normalizedY) * (24 - padding * 2);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return (
        <svg className="sparkline" viewBox="0 0 100 24" height={height} width="60" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: '6px', opacity: 0.8 }}>
            <path d={path} />
        </svg>
    );
}

// ─── Guard Helper ───

function isGuarded(p: ProcessData): boolean {
    if (!p.env) return false;
    // env is comma-separated "KEY=VAL,KEY2=VAL2" or JSON string
    try {
        const parsed = JSON.parse(p.env);
        return parsed.BGR_KEEP_ALIVE === 'true';
    } catch {
        return p.env.includes('BGR_KEEP_ALIVE=true');
    }
}

// ─── Utility: Format Runtime ───

function formatRuntime(raw: string): string {
    // raw is like "386 minutes" or "21 minutes" or "0 minutes"
    const match = raw?.match(/(\d+)\s*minute/i);
    if (!match) return raw || '-';

    const totalMinutes = parseInt(match[1]);
    if (totalMinutes <= 0) return '<1m';
    if (totalMinutes < 60) return `${totalMinutes}m`;

    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours < 24) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

function formatMemory(bytes: number): string {
    if (!bytes) return '-';
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

function formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

// ─── Helpers ───

function shortenPath(dir: string): string {
    if (!dir) return '';
    const normalized = dir.replace(/\\/g, '/');
    const parts = normalized.split('/');
    // Show last 2 segments  (e.g. "Code/bgr" instead of "c:/Code/bgr")
    if (parts.length > 2) return parts.slice(-2).join('/');
    return normalized;
}

// ─── JSX Components ───

function ProcessRow({ p, animate }: { p: ProcessData; animate?: boolean }) {
    const guarded = isGuarded(p);
    return (
        <tr data-process-name={p.name} className={animate ? 'animate-in' : ''} style={animate ? { opacity: '0' } : undefined}>
            <td>
                <div className="process-name">
                    <span>{p.name}</span>
                    <button
                        className={`guard-toggle ${guarded ? 'guarded' : ''}`}
                        data-action="guard"
                        data-name={p.name}
                        data-guarded={guarded ? 'true' : 'false'}
                        title={guarded ? 'Process is guarded — click to disable auto-restart' : 'Click to enable auto-restart guard'}
                        onClick={(e: Event) => e.stopPropagation()}
                    >
                        <ShieldIcon />
                    </button>
                </div>
            </td>
            <td>
                <span className={`status-badge ${p.running ? 'running' : 'stopped'}`}>
                    <span className="status-dot"></span>
                    {p.running ? 'Running' : 'Stopped'}
                </span>
            </td>
            <td className="pid">{String(p.pid)}</td>
            <td>
                {p.port
                    ? <a className="port-num port-link" href={`http://localhost:${p.port}`} target="_blank" rel="noopener" title={`Open localhost:${p.port}`} onClick={(e: Event) => e.stopPropagation()}>:{p.port}</a>
                    : <span style={{ color: 'var(--text-muted)' }}>–</span>
                }
            </td>
            <td className="cpu">
                {p.running && (p.cpu !== undefined)
                    ? <div className="metrics-cell">
                        <span>{p.cpu > 0 ? `${p.cpu.toFixed(1)}%` : '<0.1%'}</span>
                        <MiniSparkline data={p.cpuHistory || []} stroke="#7ee787" />
                    </div>
                    : <span style={{ color: 'var(--text-muted)' }}>–</span>
                }
            </td>
            <td className="memory">
                {p.running && p.memory > 0
                    ? <div className="metrics-cell">
                        <span className="memory-badge">{formatMemory(p.memory)}</span>
                        <MiniSparkline data={p.memoryHistory || []} stroke="#a5d6ff" />
                    </div>
                    : <span style={{ color: 'var(--text-muted)' }}>–</span>
                }
            </td>
            <td className="command" title={p.command}>{p.command}</td>
            <td className="runtime">{formatRuntime(String(p.runtime))}</td>
        </tr>
    );
}

function GroupHeader({ name, running, total, collapsed }: { name: string; running: number; total: number; collapsed: boolean }) {
    // Show short folder name as label, full path as title
    const shortName = shortenPath(name);
    return (
        <tr className={`group-header ${collapsed ? 'collapsed' : ''}`} data-group-name={name}>
            <td colSpan={8}>
                <div className="group-label" title={name}>
                    <svg className="group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                    <span className="group-name">{shortName}</span>
                    <span className="group-counts">
                        <span className={`group-count-running ${running > 0 ? 'has-running' : ''}`}>{running} running</span>
                        <span className="group-count-sep">·</span>
                        <span className="group-count-total">{total} total</span>
                    </span>
                </div>
            </td>
        </tr>
    );
}

function EmptyState() {
    return (
        <tr>
            <td colSpan={7}>
                <div className="empty-state">
                    <div className="empty-icon">📦</div>
                    <h3>No processes found</h3>
                    <p>Start a new process to see it here</p>
                </div>
            </td>
        </tr>
    );
}

function ProcessCard({ p }: { p: ProcessData }) {
    const guarded = isGuarded(p);
    return (
        <div className="process-card" data-process-name={p.name}>
            <div className="card-header">
                <div className="process-name">
                    <span>{p.name}</span>
                    {guarded && <span className="guard-badge" title="Auto-restart enabled">🛡️</span>}
                </div>
                <span className={`status-badge ${p.running ? 'running' : 'stopped'}`}>
                    <span className="status-dot"></span>
                    {p.running ? 'Running' : 'Stopped'}
                </span>
            </div>
            <div className="card-details">
                <div className="card-detail"><span className="card-label">PID</span><span>{p.pid}</span></div>
                <div className="card-detail"><span className="card-label">Port</span>{p.port ? <a className="port-link" href={`http://localhost:${p.port}`} target="_blank" rel="noopener" onClick={(e: Event) => e.stopPropagation()}>:{p.port}</a> : <span>–</span>}</div>
                <div className="card-detail"><span className="card-label">CPU</span>{p.running && (p.cpu !== undefined) ? <div style={{ display: 'flex', alignItems: 'center' }}><span>{p.cpu > 0 ? `${p.cpu.toFixed(1)}%` : '<0.1%'}</span><MiniSparkline data={p.cpuHistory || []} stroke="#7ee787" /></div> : <span>–</span>}</div>
                <div className="card-detail"><span className="card-label">Memory</span>{p.running && p.memory > 0 ? <div style={{ display: 'flex', alignItems: 'center' }}><span>{formatMemory(p.memory)}</span><MiniSparkline data={p.memoryHistory || []} stroke="#a5d6ff" /></div> : <span>–</span>}</div>
                <div className="card-detail"><span className="card-label">Runtime</span><span>{formatRuntime(String(p.runtime))}</span></div>
            </div>
            <div className="card-command" title={p.command}>{p.command}</div>
            <div className="card-actions">
                <button className={`action-btn guard ${guarded ? 'active' : ''}`} data-action="guard" data-name={p.name} data-guarded={guarded ? 'true' : 'false'} title={guarded ? 'Disable auto-restart' : 'Enable auto-restart'}>
                    <ShieldIcon /> {guarded ? 'Unguard' : 'Guard'}
                </button>
                <button className="action-btn info" data-action="logs" data-name={p.name} title="View Logs">
                    <LogsIcon /> Logs
                </button>
                {p.running
                    ? <button className="action-btn danger" data-action="stop" data-name={p.name} title="Stop">
                        <StopIcon /> Stop
                    </button>
                    : <button className="action-btn success" data-action="restart" data-name={p.name} title="Start">
                        <PlayIcon /> Start
                    </button>
                }
                <button className="action-btn warning" data-action="restart" data-name={p.name} title="Restart">
                    <RestartIcon /> Restart
                </button>
                <button className="action-btn deploy" data-action="deploy" data-name={p.name} title="Deploy (git pull + restart)">
                    <DeployIcon /> Deploy
                </button>
                <button className="action-btn danger" data-action="delete" data-name={p.name} title="Delete">
                    <TrashIcon /> Delete
                </button>
            </div>
        </div>
    );
}

// ─── ANSI to HTML converter ───
const ANSI_COLORS: Record<number, string> = {
    30: '#6e7681', 31: '#ff7b72', 32: '#7ee787', 33: '#d2a458',
    34: '#79c0ff', 35: '#d2a8ff', 36: '#a5d6ff', 37: '#c9d1d9',
    90: '#8b949e', 91: '#ffa198', 92: '#aff5b4', 93: '#f8e3a1',
    94: '#a5d6ff', 95: '#e2c5ff', 96: '#b6e3ff', 97: '#f0f6fc',
};
const ANSI_BG: Record<number, string> = {
    40: '#6e7681', 41: '#ff7b72', 42: '#7ee787', 43: '#d2a458',
    44: '#79c0ff', 45: '#d2a8ff', 46: '#a5d6ff', 47: '#c9d1d9',
};

function ansiToHtml(text: string): string {
    let result = '';
    let openSpans = 0;
    const parts = text.split(/(\x1b\[[0-9;]*m)/);

    for (const part of parts) {
        const match = part.match(/^\x1b\[([0-9;]*)m$/);
        if (!match) {
            // Escape HTML entities
            result += part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            continue;
        }

        const codes = match[1].split(';').map(Number);
        for (const code of codes) {
            if (code === 0) {
                // Reset
                while (openSpans > 0) { result += '</span>'; openSpans--; }
            } else if (code === 1) {
                result += '<span style="font-weight:bold">'; openSpans++;
            } else if (code === 2) {
                result += '<span style="opacity:0.6">'; openSpans++;
            } else if (code === 3) {
                result += '<span style="font-style:italic">'; openSpans++;
            } else if (code === 4) {
                result += '<span style="text-decoration:underline">'; openSpans++;
            } else if (ANSI_COLORS[code]) {
                result += `<span style="color:${ANSI_COLORS[code]}">`; openSpans++;
            } else if (ANSI_BG[code]) {
                result += `<span style="background:${ANSI_BG[code]}">`; openSpans++;
            }
        }
    }
    while (openSpans > 0) { result += '</span>'; openSpans--; }
    return result;
}

// ─── Toast System ───

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons: Record<string, string> = { success: '✓', error: '✕', info: 'i' };

    const toast = (
        <div className={`toast ${type}`}>
            <div className="toast-icon">{icons[type]}</div>
            <span>{message}</span>
        </div>
    ) as unknown as HTMLElement;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 250);
    }, 3000);
}

// ─── Mount Function ───

export default function mount(): () => void {
    const $ = (id: string) => document.getElementById(id);
    let selectedProcess: string | null = null;
    let isFetching = false;
    let isFirstLoad = true;
    let allProcesses: ProcessData[] = [];
    let searchQuery = '';
    let collapsedGroups: Set<string> = new Set(JSON.parse(localStorage.getItem('bgr_collapsed_groups') || '[]'));
    let drawerProcess: string | null = null;
    let drawerTab: 'stdout' | 'stderr' = 'stdout';
    let activeSection = 'logs'; // Which accordion section is open: 'info' | 'config' | 'logs'
    let mutationUntil = 0; // Timestamp: ignore SSE updates until this time (after mutations)
    let configSubtab = 'toml'; // 'toml' | 'env'
    let logAutoScroll = localStorage.getItem('bgr_autoscroll') === 'true'; // OFF by default
    let logSearch = '';
    let logLinesRaw: string[] = [];  // Raw text (for search filtering)
    let logLinesHtml: string[] = []; // Pre-converted HTML (cached ansiToHtml)
    let logOffset = 0;            // Byte offset for incremental fetching
    let logCurrentTab = '';       // Track tab to reset on switch
    let logLastSize = -1;         // Detect no-change polls
    let logNeedsFullRebuild = true; // Full DOM rebuild flag (on tab switch, search change)

    // ─── Version Badge ───
    const versionBadge = $('version-badge');
    async function loadVersion() {
        if (!versionBadge) return;
        try {
            const res = await fetch('/api/version');
            const data = await res.json();
            versionBadge.textContent = data.version ? `v${data.version}` : 'bgrun';
        } catch {
            versionBadge.textContent = 'bgrun';
        }
    }
    loadVersion();

    // ─── Load & Render Processes ───

    async function loadProcesses() {
        if (isFetching) return;
        isFetching = true;
        try {
            const res = await fetch('/api/processes');
            allProcesses = await res.json();
            renderFilteredProcesses();
            updateStats(allProcesses);
        } catch {
            // silently retry on next tick
        } finally {
            isFetching = false;
        }
    }

    function renderFilteredProcesses() {
        const filtered = searchQuery
            ? allProcesses.filter(p =>
                p.name.toLowerCase().includes(searchQuery) ||
                p.command.toLowerCase().includes(searchQuery) ||
                (p.port && String(p.port).includes(searchQuery))
            )
            : allProcesses;
        renderProcesses(filtered);
    }

    function updateStats(processes: ProcessData[]) {
        const total = processes.length;
        const running = processes.filter(p => p.running).length;
        const stopped = total - running;
        const guarded = processes.filter(p => isGuarded(p)).length;
        const guardable = processes.filter(p => p.name !== 'bgr-dashboard').length;
        const totalMemory = processes.reduce((sum, p) => sum + (p.memory || 0), 0);

        const tc = $('total-count');
        const rc = $('running-count');
        const sc = $('stopped-count');
        const gc = $('guarded-count');
        const mc = $('memory-count');
        const rrc = $('restarts-count');
        if (tc) tc.textContent = String(total);
        if (rc) rc.textContent = String(running);
        if (sc) sc.textContent = String(stopped);
        if (gc) gc.textContent = String(guarded);
        if (mc) mc.textContent = formatMemory(totalMemory) || '0 MB';
        const totalRestarts = processes.reduce((sum, p) => sum + (p.guardRestarts || 0), 0);
        if (rrc) rrc.textContent = String(totalRestarts);

        // Update Guard All button state
        const guardAllBtn = $('guard-all-btn');
        const guardAllLabel = $('guard-all-label');
        if (guardAllBtn && guardAllLabel) {
            const allGuarded = guardable > 0 && guarded >= guardable;
            guardAllBtn.classList.toggle('all-guarded', allGuarded);
            guardAllLabel.textContent = allGuarded ? 'Unguard All' : 'Guard All';
            guardAllBtn.title = allGuarded ? 'Remove guard from all processes' : 'Guard all processes (auto-restart on crash)';
        }

        // Update guard sentinel pill
        const guardPill = $('guard-sentinel-pill');
        const guardLabel = $('guard-sentinel-label');
        if (guardPill && guardLabel) {
            const guardProc = processes.find(p => p.name === 'bgr-guard');
            guardPill.classList.remove('active', 'stopped');
            if (guardProc && guardProc.running) {
                guardPill.classList.add('active');
                const restarts = guardProc.guardRestarts || 0;
                guardLabel.textContent = restarts > 0 ? `Guard: ON (${restarts}↻)` : 'Guard: ON';
            } else if (guardProc) {
                guardPill.classList.add('stopped');
                guardLabel.textContent = 'Guard: OFF';
            } else {
                guardLabel.textContent = 'Guard: –';
            }
        }
    }

    function renderProcesses(processes: ProcessData[]) {
        const tbody = $('processes-table');
        const cardsEl = $('mobile-cards');
        if (!tbody) return;

        if (processes.length === 0) {
            tbody.replaceChildren(<EmptyState /> as unknown as Node);
            if (cardsEl) cardsEl.replaceChildren(
                <div className="empty-state">
                    <div className="empty-icon">📦</div>
                    <h3>No processes found</h3>
                    <p>Start a new process to see it here</p>
                </div> as unknown as Node
            );
            return;
        }

        const animate = isFirstLoad;

        // Group by working directory
        const groups: Record<string, ProcessData[]> = {};
        processes.forEach(p => {
            const key = p.directory || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        const nodes: Node[] = [];
        const sortedGroupKeys = Object.keys(groups).sort();

        // Always show group headers for every directory
        sortedGroupKeys.forEach(groupDir => {
            const procs = groups[groupDir];
            const running = procs.filter(p => p.running).length;
            const collapsed = collapsedGroups.has(groupDir);
            nodes.push(<GroupHeader name={groupDir} running={running} total={procs.length} collapsed={collapsed} /> as unknown as Node);
            if (!collapsed) {
                procs.forEach(p => {
                    nodes.push(<ProcessRow p={p} animate={animate} /> as unknown as Node);
                });
            }
        });

        tbody.replaceChildren(...nodes);

        // Add click handlers for group headers (toggle collapse)
        tbody.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener('click', (e: Event) => {
                // Don't collapse if clicking action buttons
                if ((e.target as Element).closest('[data-action]')) return;
                const groupName = (header as HTMLElement).dataset.groupName;
                if (!groupName) return;
                if (collapsedGroups.has(groupName)) {
                    collapsedGroups.delete(groupName);
                } else {
                    collapsedGroups.add(groupName);
                }
                localStorage.setItem('bgr_collapsed_groups', JSON.stringify([...collapsedGroups]));
                renderFilteredProcesses();
            });
        });

        // Render mobile cards
        if (cardsEl) {
            const cards = processes.map(p => <ProcessCard p={p} /> as unknown as Node);
            cardsEl.replaceChildren(...cards);
        }

        if (isFirstLoad) isFirstLoad = false;

        // Highlight selected row
        if (drawerProcess) {
            const row = tbody.querySelector(`tr[data-process-name="${drawerProcess}"]`);
            if (row) row.classList.add('selected');
        }
    }

    // ─── Search ───

    const searchInput = $('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value.toLowerCase().trim();
        renderFilteredProcesses();
    });

    /** Fetch with cache-bust to force fresh data after mutations */
    async function loadProcessesFresh() {
        isFetching = true;
        try {
            const res = await fetch(`/api/processes?t=${Date.now()}`);
            allProcesses = await res.json();
            renderFilteredProcesses();
            updateStats(allProcesses);
        } catch { /* retry on next tick */ }
        finally { isFetching = false; }
    }

    async function handleAction(e: Event) {
        const btn = (e.target as Element).closest('[data-action]') as HTMLElement;
        if (!btn) return;

        const action = btn.dataset.action;
        const name = btn.dataset.name;
        if (!name) return;

        switch (action) {
            case 'stop': {
                // Optimistic: mark stopped immediately
                const proc = allProcesses.find(p => p.name === name);
                if (proc) {
                    proc.running = false;
                    proc.memory = 0;
                    renderFilteredProcesses();
                    updateStats(allProcesses);
                }
                try {
                    const res = await fetch(`/api/stop/${encodeURIComponent(name)}`, { method: 'POST' });
                    if (res.ok) {
                        showToast(`Stopped "${name}"`, 'success');
                    } else {
                        const data = await res.json();
                        showToast(data.error || `Failed to stop "${name}"`, 'error');
                    }
                } catch {
                    showToast(`Failed to stop "${name}"`, 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 3000;
                break;
            }

            case 'restart': {
                // Optimistic: mark running immediately
                const proc = allProcesses.find(p => p.name === name);
                if (proc) {
                    proc.running = true;
                    renderFilteredProcesses();
                    updateStats(allProcesses);
                }
                try {
                    const res = await fetch(`/api/restart/${encodeURIComponent(name)}`, { method: 'POST' });
                    if (res.ok) {
                        showToast(`Restarted "${name}"`, 'success');
                    } else {
                        const data = await res.json();
                        showToast(data.error || `Failed to restart "${name}"`, 'error');
                    }
                } catch {
                    showToast(`Failed to restart "${name}"`, 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 3000;
                break;
            }

            case 'delete': {
                // Optimistic: remove from array immediately
                allProcesses = allProcesses.filter(p => p.name !== name);
                renderFilteredProcesses();
                updateStats(allProcesses);
                if (drawerProcess === name) closeDrawer();
                try {
                    const res = await fetch(`/api/processes/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast(`Deleted "${name}"`, 'success');
                    } else {
                        const data = await res.json();
                        showToast(data.error || `Failed to delete "${name}"`, 'error');
                    }
                } catch {
                    showToast(`Failed to delete "${name}"`, 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 3000;
                break;
            }

            case 'deploy': {
                showToast(`Deploying "${name}"...`, 'info');
                try {
                    const res = await fetch(`/api/deploy/${encodeURIComponent(name)}`, { method: 'POST' });
                    const data = await res.json();
                    if (res.ok) {
                        showToast(`Deployed "${name}" successfully`, 'success');
                    } else {
                        showToast(data.error || `Failed to deploy "${name}"`, 'error');
                    }
                } catch {
                    showToast(`Failed to deploy "${name}"`, 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 5000;
                break;
            }

            case 'guard': {
                const currentlyGuarded = btn.dataset.guarded === 'true';
                const newState = !currentlyGuarded;
                try {
                    const res = await fetch('/api/guard', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, enabled: newState }),
                    });
                    if (res.ok) {
                        showToast(`${newState ? 'Guarded' : 'Unguarded'} "${name}"`, 'success');
                    } else {
                        const data = await res.json();
                        showToast(data.error || `Failed to toggle guard for "${name}"`, 'error');
                    }
                } catch {
                    showToast(`Failed to toggle guard for "${name}"`, 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 3000;
                break;
            }

            case 'logs':
                openDrawer(name);
                break;
        }
    }

    const tbody = $('processes-table');

    // ─── Context Menu ───
    let contextMenuEl: HTMLElement | null = null;

    function closeContextMenu() {
        if (contextMenuEl) {
            contextMenuEl.classList.add('closing');
            setTimeout(() => { contextMenuEl?.remove(); contextMenuEl = null; }, 150);
        }
    }

    function showContextMenu(name: string, x: number, y: number) {
        closeContextMenu();
        const proc = allProcesses.find(p => p.name === name);
        if (!proc) return;

        const guarded = isGuarded(proc);
        const menu = (
            <div className="context-menu" style={{ left: `${x}px`, top: `${y}px` }}>
                <button className="context-item" data-action="logs" data-name={name}>
                    <LogsIcon /> View Logs
                </button>
                <div className="context-divider"></div>
                <button className={`context-item ${guarded ? 'guard-active' : 'guard'}`} data-action="guard" data-name={name} data-guarded={guarded ? 'true' : 'false'}>
                    <ShieldIcon /> {guarded ? 'Disable Guard' : 'Enable Guard'}
                </button>
                <div className="context-divider"></div>
                {proc.running
                    ? <button className="context-item danger" data-action="stop" data-name={name}>
                        <StopIcon /> Stop
                    </button>
                    : <button className="context-item success" data-action="restart" data-name={name}>
                        <PlayIcon /> Start
                    </button>
                }
                <button className="context-item" data-action="restart" data-name={name}>
                    <RestartIcon /> Restart
                </button>
                <button className="context-item deploy" data-action="deploy" data-name={name}>
                    <DeployIcon /> Deploy
                </button>
                <div className="context-divider"></div>
                <button className="context-item danger" data-action="delete" data-name={name}>
                    <TrashIcon /> Delete
                </button>
            </div>
        ) as unknown as HTMLElement;

        // Handle clicks inside the menu
        menu.addEventListener('click', (e: Event) => {
            const item = (e.target as Element).closest('[data-action]');
            if (item) {
                handleAction(e);
                closeContextMenu();
            }
        });

        document.body.appendChild(menu);
        contextMenuEl = menu;

        // Adjust position if menu goes off-screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    }

    // Right-click on table rows → context menu
    tbody?.addEventListener('contextmenu', (e: Event) => {
        const me = e as MouseEvent;
        const row = (me.target as Element).closest('tr[data-process-name]') as HTMLElement;
        if (row && row.dataset.processName) {
            me.preventDefault();
            showContextMenu(row.dataset.processName, me.clientX, me.clientY);
        }
    });

    // Close context menu on click outside or Escape
    document.addEventListener('click', (e: Event) => {
        if (contextMenuEl && !contextMenuEl.contains(e.target as Node)) {
            closeContextMenu();
        }
    });
    document.addEventListener('contextmenu', (e: Event) => {
        // Allow right-click to close existing menu when clicking elsewhere
        if (contextMenuEl && !contextMenuEl.contains(e.target as Node)) {
            const row = (e.target as Element).closest('tr[data-process-name]');
            if (!row) closeContextMenu();
        }
    });

    // Row click → open drawer (left click)
    tbody?.addEventListener('click', (e: Event) => {
        const row = (e.target as Element).closest('tr[data-process-name]') as HTMLElement;
        if (row && row.dataset.processName) {
            openDrawer(row.dataset.processName);
        }
    });

    // Mobile cards click → keep inline buttons
    const mobileCards = $('mobile-cards');
    mobileCards?.addEventListener('click', (e: Event) => {
        const btn = (e.target as Element).closest('[data-action]');
        if (btn) {
            handleAction(e);
            return;
        }
        const card = (e.target as Element).closest('.process-card[data-process-name]') as HTMLElement;
        if (card && card.dataset.processName) {
            openDrawer(card.dataset.processName);
        }
    });

    // Mobile cards → context menu on long-press
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    mobileCards?.addEventListener('touchstart', (e: Event) => {
        const te = e as TouchEvent;
        const card = (te.target as Element).closest('.process-card[data-process-name]') as HTMLElement;
        if (card && card.dataset.processName) {
            const name = card.dataset.processName;
            const touch = te.touches[0];
            longPressTimer = setTimeout(() => {
                showContextMenu(name, touch.clientX, touch.clientY);
            }, 500);
        }
    });
    mobileCards?.addEventListener('touchend', () => { if (longPressTimer) clearTimeout(longPressTimer); });
    mobileCards?.addEventListener('touchmove', () => { if (longPressTimer) clearTimeout(longPressTimer); });

    // ─── Detail Drawer ───

    const drawer = $('detail-drawer');
    const backdrop = $('drawer-backdrop');

    function openAccordionSection(section: string) {
        activeSection = section;
        const sections = drawer?.querySelectorAll('.accordion-section');
        sections?.forEach(el => {
            const s = el.querySelector('.accordion-trigger')?.getAttribute('data-section');
            el.classList.toggle('open', s === section);
        });

        // Load data for the opened section
        if (section === 'config') {
            if (configSubtab === 'toml') loadConfigPanel();
            else renderEnvPanel();
        } else if (section === 'logs') {
            refreshDrawerLogs();
        }
    }

    function switchConfigSubtab(subtab: string) {
        configSubtab = subtab;
        const tomlPanel = $('config-panel-toml');
        const envPanel = $('config-panel-env');
        if (tomlPanel) tomlPanel.style.display = subtab === 'toml' ? '' : 'none';
        if (envPanel) envPanel.style.display = subtab === 'env' ? '' : 'none';
        $('config-subtabs')?.querySelectorAll('.accordion-subtab').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.subtab === subtab);
        });
        if (subtab === 'toml') loadConfigPanel();
        else renderEnvPanel();
    }

    function switchLogSubtab(subtab: string, skipRefresh = false) {
        drawerTab = subtab as 'stdout' | 'stderr';
        $('log-subtabs')?.querySelectorAll('.accordion-subtab').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.subtab === subtab);
        });
        logLinesRaw = [];
        logLinesHtml = [];
        logOffset = 0;
        logCurrentTab = '';
        logLastSize = -1;
        logNeedsFullRebuild = true;
        if (!skipRefresh) refreshDrawerLogs();
    }

    function renderEnvPanel() {
        const envEl = $('drawer-env');
        if (!envEl || !drawerProcess) return;
        const proc = allProcesses.find(p => p.name === drawerProcess);
        if (!proc || !proc.env) {
            envEl.innerHTML = '<div class="env-empty">No environment variables configured</div>';
            return;
        }
        const pairs = proc.env.split(',').filter(Boolean).map(s => {
            const idx = s.indexOf('=');
            return idx > 0 ? [s.slice(0, idx), s.slice(idx + 1)] : [s, ''];
        });
        if (pairs.length === 0) {
            envEl.innerHTML = '<div class="env-empty">No environment variables configured</div>';
            return;
        }
        envEl.innerHTML = pairs.map(([k, v]) =>
            `<div class="env-row"><span class="env-key" title="${k}">${k}</span><span class="env-value">${v}</span></div>`
        ).join('');
    }

    async function loadConfigPanel() {
        const configEditor = $('config-editor') as HTMLTextAreaElement;
        const configPath = $('config-path');
        if (!configEditor || !drawerProcess) return;

        try {
            const res = await fetch(`/api/config/${encodeURIComponent(drawerProcess)}`);
            const data = await res.json();
            configEditor.value = data.content || '';
            if (configPath) {
                configPath.textContent = data.path || 'No config file';
                configPath.title = data.path || '';
            }
            if (!data.exists) {
                configEditor.placeholder = 'No .config.toml found for this process';
            }
        } catch {
            configEditor.value = '';
            if (configPath) configPath.textContent = 'Failed to load config';
        }
    }

    function openDrawer(name: string) {
        drawerProcess = name;
        drawerTab = 'stdout';

        // Update header
        const nameEl = $('drawer-process-name');
        if (nameEl) nameEl.textContent = name;

        // Update meta info
        const proc = allProcesses.find(p => p.name === name);
        const meta = $('drawer-meta');
        if (meta && proc) {
            const guarded = isGuarded(proc);
            const metaItems = [
                { label: 'Status', value: proc.running ? '● Running' : '○ Stopped' },
                { label: 'PID', value: String(proc.pid) },
                { label: 'Port', value: proc.port ? `:${proc.port}` : '–', href: proc.port ? `http://localhost:${proc.port}` : undefined },
                { label: 'Runtime', value: formatRuntime(String(proc.runtime)) },
                { label: 'Command', value: proc.command },
                { label: 'Directory', value: proc.directory || '–' },
                { label: 'Memory', value: formatMemory(proc.memory) },
                { label: 'Group', value: proc.group || '–' },
            ];

            const items = metaItems.map((m: any) => (
                <div className="meta-item">
                    <span className="meta-label">{m.label}</span>
                    {m.href
                        ? <a className="meta-value port-link" href={m.href} target="_blank" rel="noopener">{m.value}</a>
                        : <span className="meta-value">{m.value}</span>
                    }
                </div>
            ) as unknown as Node);

            // Guard toggle row with inline switch
            const guardRow = (
                <div className={`meta-item meta-guard ${guarded ? 'guarded' : ''}`}>
                    <span className="meta-label">
                        <ShieldIcon /> Guard
                    </span>
                    <label className="guard-toggle" title={guarded ? 'Auto-restart is ON — click to disable' : 'Auto-restart is OFF — click to enable'}>
                        <input type="checkbox" checked={guarded} className="guard-toggle-input" />
                        <span className="guard-toggle-track">
                            <span className="guard-toggle-thumb"></span>
                        </span>
                        <span className="guard-toggle-label">{guarded ? 'Protected' : 'Off'}</span>
                    </label>
                </div>
            ) as unknown as HTMLElement;

            // Wire toggle click
            const checkbox = guardRow.querySelector('.guard-toggle-input') as HTMLInputElement;
            checkbox?.addEventListener('change', async () => {
                const newState = checkbox.checked;
                const labelEl = guardRow.querySelector('.guard-toggle-label');
                const trackEl = guardRow.querySelector('.guard-toggle-track');
                // Optimistic UI update
                if (labelEl) labelEl.textContent = newState ? 'Protected' : 'Off';
                guardRow.classList.toggle('guarded', newState);
                try {
                    const res = await fetch('/api/guard', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, enabled: newState }),
                    });
                    if (res.ok) {
                        showToast(`${newState ? 'Guard enabled' : 'Guard disabled'} for "${name}"`, 'success');
                    } else {
                        // Rollback
                        checkbox.checked = !newState;
                        if (labelEl) labelEl.textContent = !newState ? 'Protected' : 'Off';
                        guardRow.classList.toggle('guarded', !newState);
                        showToast('Failed to toggle guard', 'error');
                    }
                } catch {
                    checkbox.checked = !newState;
                    if (labelEl) labelEl.textContent = !newState ? 'Protected' : 'Off';
                    guardRow.classList.toggle('guarded', !newState);
                    showToast('Failed to toggle guard', 'error');
                }
                await loadProcessesFresh();
                mutationUntil = Date.now() + 3000;
            });

            // Guard restart counter (only shown when > 0)
            const extraRows: Node[] = [];
            if (proc.guardRestarts > 0) {
                extraRows.push((
                    <div className="meta-item meta-restarts">
                        <span className="meta-label">Guard Restarts</span>
                        <span className="meta-value">
                            <span className="restart-count-badge">{proc.guardRestarts}</span>
                            <span className="restart-count-text">
                                {proc.guardRestarts === 1 ? 'auto-restart this session' : 'auto-restarts this session'}
                            </span>
                        </span>
                    </div>
                ) as unknown as Node);
            }

            meta.replaceChildren(...items, guardRow, ...extraRows);
        }

        // Reset log subtab to stdout (skip auto-refresh, we call it once below)
        switchLogSubtab('stdout', true);

        // Open logs accordion by default
        openAccordionSection('logs');

        // Show drawer
        drawer?.classList.add('open');
        backdrop?.classList.add('active');

        // Highlight table row
        tbody?.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
        const row = tbody?.querySelector(`tr[data-process-name="${name}"]`);
        if (row) row.classList.add('selected');

        // Fetch stderr line count for badge
        // Note: openAccordionSection('logs') above already calls refreshDrawerLogs()
        updateStderrBadge(name);
    }

    async function updateStderrBadge(name: string) {
        const badge = $('stderr-badge');
        if (!badge) return;
        try {
            const res = await fetch(`/api/logs/${encodeURIComponent(name)}?tab=stderr&offset=0`);
            const data = await res.json();
            const text: string = data.text || '';
            if (!text.trim()) {
                badge.style.display = 'none';
                return;
            }
            const count = text.split('\n').filter(Boolean).length;
            if (count > 0) {
                badge.textContent = count > 999 ? `${Math.floor(count / 1000)}k` : String(count);
                badge.style.display = '';
            } else {
                badge.style.display = 'none';
            }
        } catch {
            badge.style.display = 'none';
        }
    }

    function closeDrawer() {
        drawer?.classList.remove('open');
        backdrop?.classList.remove('active');
        drawerProcess = null;
        tbody?.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
    }

    // Use keyed reconciler for efficient log line diffing
    setReconciler('keyed');

    function fullRebuildLogs(logsEl: HTMLElement) {
        const search = logSearch.toLowerCase();
        if (logLinesRaw.length === 0 || (logLinesRaw.length === 1 && !logLinesRaw[0])) {
            logsEl.innerHTML = '<em style="color: var(--text-muted)">No logs available</em>';
            updateLogCount(0);
            logNeedsFullRebuild = false;
            return;
        }

        // Build all HTML in one pass using cached ansiToHtml results
        const chunks: string[] = [];
        let count = 0;
        for (let i = 0; i < logLinesRaw.length; i++) {
            if (search && !logLinesRaw[i].toLowerCase().includes(search)) continue;
            count++;
            const num = i + 1;
            chunks.push(`<div class="log-line" data-ln="${num}"><span class="log-line-num">${num}</span><span class="log-line-content">${logLinesHtml[i]}</span></div>`);
        }
        logsEl.innerHTML = chunks.join('');
        updateLogCount(count);
        logNeedsFullRebuild = false;
    }

    function appendNewLogLines(logsEl: HTMLElement, startIndex: number) {
        // Fast path: append only new lines to existing DOM
        const search = logSearch.toLowerCase();
        const fragment = document.createDocumentFragment();
        let count = 0;
        for (let i = startIndex; i < logLinesRaw.length; i++) {
            if (search && !logLinesRaw[i].toLowerCase().includes(search)) continue;
            count++;
            const div = document.createElement('div');
            div.className = 'log-line';
            div.setAttribute('data-ln', String(i + 1));
            div.innerHTML = `<span class="log-line-num">${i + 1}</span><span class="log-line-content">${logLinesHtml[i]}</span>`;
            fragment.appendChild(div);
        }
        if (count > 0) logsEl.appendChild(fragment);
        // Update total count
        const total = search
            ? logLinesRaw.filter(l => l.toLowerCase().includes(search)).length
            : logLinesRaw.length;
        updateLogCount(total);
    }

    function updateLogCount(count: number) {
        const countEl = $('log-line-count');
        if (countEl) countEl.textContent = `${count} line${count !== 1 ? 's' : ''}`;
    }

    async function refreshDrawerLogs() {
        if (!drawerProcess) return;
        if (drawerTab !== 'stdout' && drawerTab !== 'stderr') return;
        const logsEl = $('drawer-logs') as HTMLElement;
        if (!logsEl) return;

        // Reset on tab switch
        if (logCurrentTab !== drawerTab) {
            logLinesRaw = [];
            logLinesHtml = [];
            logOffset = 0;
            logCurrentTab = drawerTab;
            logLastSize = -1;
            logNeedsFullRebuild = true;
        }

        try {
            const res = await fetch(`/api/logs/${encodeURIComponent(drawerProcess)}?tab=${drawerTab}&offset=${logOffset}`);
            const data = await res.json();
            const newText: string = data.text || '';
            const newSize: number = data.size || 0;

            // ── Fast bail: nothing changed since last poll ──
            if (!newText && newSize === logLastSize && !logNeedsFullRebuild) {
                return; // zero work, zero DOM touches
            }
            logLastSize = newSize;

            // Update file info bar (lightweight, runs always)
            const infoEl = $('log-file-info');
            if (infoEl) {
                const parts: string[] = [];
                if (data.filePath) {
                    parts.push(`<span style="color:var(--text-dim)" title="${data.filePath}">${data.filePath}</span>`);
                }
                if (data.mtime) {
                    const ago = formatTimeAgo(new Date(data.mtime));
                    parts.push(`<span style="color:var(--text-secondary)">${ago}</span>`);
                }
                infoEl.innerHTML = parts.join(' <span style="color:var(--text-muted)">·</span> ');
            }

            // ── Append new lines with cached HTML ──
            const prevCount = logLinesRaw.length;
            if (newText) {
                const newLines = newText.split('\n');
                if (logLinesRaw.length > 0 && logOffset > 0 && prevCount > 0) {
                    // Merge partial last line
                    logLinesRaw[prevCount - 1] += newLines[0];
                    logLinesHtml[prevCount - 1] = ansiToHtml(logLinesRaw[prevCount - 1]);
                    for (let i = 1; i < newLines.length; i++) {
                        logLinesRaw.push(newLines[i]);
                        logLinesHtml.push(ansiToHtml(newLines[i]));
                    }
                    // Need to rebuild first merged line in DOM
                    logNeedsFullRebuild = true;
                } else {
                    logLinesRaw = newLines;
                    logLinesHtml = newLines.map(l => ansiToHtml(l));
                }
            }

            logOffset = newSize;

            // ── Render ──
            if (logNeedsFullRebuild) {
                fullRebuildLogs(logsEl);
            } else if (logLinesRaw.length > prevCount) {
                appendNewLogLines(logsEl, prevCount);
            }
            // else: nothing to do

            if (logAutoScroll) {
                logsEl.scrollTop = logsEl.scrollHeight;
            }
        } catch {
            const logsEl = $('drawer-logs') as HTMLElement;
            if (logsEl) logsEl.innerHTML = '<em style="color: var(--text-muted)">Failed to load logs</em>';
        }
    }

    $('drawer-close-btn')?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);

    // Auto-scroll toggle — pill button with icon + label
    const autoScrollBtn = $('log-autoscroll-btn');
    function updateAutoScrollBtn() {
        if (!autoScrollBtn) return;
        autoScrollBtn.classList.toggle('active', logAutoScroll);
        // Keep the SVG icon, update the text node
        const svg = autoScrollBtn.querySelector('svg');
        autoScrollBtn.textContent = '';
        if (svg) autoScrollBtn.appendChild(svg);
        autoScrollBtn.appendChild(document.createTextNode(logAutoScroll ? 'Following' : 'Follow'));
        autoScrollBtn.title = logAutoScroll ? 'Auto-scroll: ON — click to pause' : 'Auto-scroll: OFF — click to follow';
    }
    updateAutoScrollBtn(); // Set initial state

    autoScrollBtn?.addEventListener('click', () => {
        logAutoScroll = !logAutoScroll;
        localStorage.setItem('bgr_autoscroll', String(logAutoScroll));
        updateAutoScrollBtn();
        if (logAutoScroll) {
            const logsEl = $('drawer-logs');
            if (logsEl) logsEl.scrollTop = logsEl.scrollHeight;
        }
    });

    // Click log line → expand/collapse (word-wrap toggle)
    const logsContainer = $('drawer-logs');
    logsContainer?.addEventListener('click', (e: Event) => {
        const line = (e.target as Element).closest('.log-line') as HTMLElement;
        if (!line) return;
        line.classList.toggle('expanded');
    });

    // Double-click log line → copy content to clipboard
    logsContainer?.addEventListener('dblclick', (e: Event) => {
        const line = (e.target as Element).closest('.log-line') as HTMLElement;
        if (!line) return;
        const content = line.querySelector('.log-line-content');
        if (!content) return;
        const text = content.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
            line.classList.add('copied');
            setTimeout(() => line.classList.remove('copied'), 1200);
        });
        e.preventDefault();
    });

    // Log search/filter with debounce
    let logSearchTimeout: ReturnType<typeof setTimeout> | null = null;
    $('log-search')?.addEventListener('input', (e) => {
        if (logSearchTimeout) clearTimeout(logSearchTimeout);
        logSearchTimeout = setTimeout(() => {
            logSearch = (e.target as HTMLInputElement).value;
            logNeedsFullRebuild = true;
            refreshDrawerLogs();
        }, 200);
    });

    // Accordion section triggers
    drawer?.querySelectorAll('.accordion-trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const section = (trigger as HTMLElement).dataset.section;
            if (section) openAccordionSection(section);
        });
    });

    // Config subtab switching
    $('config-subtabs')?.querySelectorAll('.accordion-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            const subtab = (btn as HTMLElement).dataset.subtab;
            if (subtab) switchConfigSubtab(subtab);
        });
    });

    // Log subtab switching
    $('log-subtabs')?.querySelectorAll('.accordion-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            const subtab = (btn as HTMLElement).dataset.subtab;
            if (subtab) switchLogSubtab(subtab);
        });
    });

    // Config save button
    $('config-save-btn')?.addEventListener('click', async () => {
        if (!drawerProcess) return;
        const editor = $('config-editor') as HTMLTextAreaElement;
        if (!editor) return;
        try {
            const res = await fetch(`/api/config/${encodeURIComponent(drawerProcess)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editor.value }),
            });
            if (res.ok) {
                showToast(`Config saved for "${drawerProcess}"`, 'success');
                // Restart the process
                await fetch(`/api/restart/${encodeURIComponent(drawerProcess)}`, { method: 'POST' });
                showToast(`Restarted "${drawerProcess}"`, 'success');
                await loadProcessesFresh();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to save config', 'error');
            }
        } catch {
            showToast('Failed to save config', 'error');
        }
    });

    // ─── Drawer Resize ───

    const resizeHandle = $('drawer-resize-handle');
    if (resizeHandle && drawer) {
        let startX = 0;
        let startWidth = 0;

        const onMouseMove = (e: MouseEvent) => {
            const delta = startX - e.clientX;
            const newWidth = Math.min(Math.max(startWidth + delta, 360), window.innerWidth * 0.85);
            drawer.style.width = `${newWidth}px`;
        };

        const onMouseUp = () => {
            drawer.classList.remove('resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            // Persist width
            localStorage.setItem('bgr_drawer_width', drawer.style.width);
        };

        resizeHandle.addEventListener('mousedown', (e: Event) => {
            const me = e as MouseEvent;
            startX = me.clientX;
            startWidth = drawer.offsetWidth;
            drawer.classList.add('resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            me.preventDefault();
        });

        // Restore saved width
        const savedWidth = localStorage.getItem('bgr_drawer_width');
        if (savedWidth) drawer.style.width = savedWidth;
    }

    // ─── New Process Modal ───

    function openModal() {
        const modal = $('new-process-modal');
        if (modal) modal.classList.add('active');
    }

    function closeModal() {
        const modal = $('new-process-modal');
        if (modal) modal.classList.remove('active');
        const nameInput = $('process-name-input') as HTMLInputElement;
        const cmdInput = $('process-command-input') as HTMLInputElement;
        const dirInput = $('process-directory-input') as HTMLInputElement;
        if (nameInput) nameInput.value = '';
        if (cmdInput) cmdInput.value = '';
        if (dirInput) dirInput.value = '';
    }

    async function createProcess() {
        const name = ($('process-name-input') as HTMLInputElement)?.value?.trim();
        const command = ($('process-command-input') as HTMLInputElement)?.value?.trim();
        const directory = ($('process-directory-input') as HTMLInputElement)?.value?.trim();

        if (!name || !command || !directory) {
            showToast('Please fill in all fields', 'error');
            return;
        }

        try {
            const res = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, command, directory }),
            });

            if (res.ok) {
                closeModal();
                showToast(`Created "${name}"`, 'success');
                await loadProcesses();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to create process', 'error');
            }
        } catch (err: any) {
            showToast('Failed to create process', 'error');
        }
    }

    $('new-process-btn')?.addEventListener('click', openModal);
    $('modal-close-btn')?.addEventListener('click', closeModal);
    $('modal-cancel-btn')?.addEventListener('click', closeModal);
    $('modal-create-btn')?.addEventListener('click', createProcess);

    // Close modal on overlay click
    $('new-process-modal')?.addEventListener('click', (e) => {
        if ((e.target as Element).classList.contains('modal-overlay')) {
            closeModal();
        }
    });

    // ─── Toolbar Actions ───
    $('refresh-btn')?.addEventListener('click', () => {
        loadProcesses();
        if (drawerProcess) refreshDrawerLogs();
    });

    // ─── Guard All Button ───
    $('guard-all-btn')?.addEventListener('click', async () => {
        const guardAllBtn = $('guard-all-btn') as HTMLButtonElement;
        if (!guardAllBtn) return;

        const guardable = allProcesses.filter(p => p.name !== 'bgr-dashboard');
        const guarded = guardable.filter(p => isGuarded(p)).length;
        const allGuarded = guardable.length > 0 && guarded >= guardable.length;
        const newState = !allGuarded;

        // Disable button during operation
        guardAllBtn.disabled = true;
        guardAllBtn.style.opacity = '0.5';

        try {
            const res = await fetch('/api/guard-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: newState }),
            });
            if (res.ok) {
                const data = await res.json();
                showToast(
                    `${newState ? 'Guarded' : 'Unguarded'} ${data.count} process${data.count !== 1 ? 'es' : ''}`,
                    'success'
                );
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to toggle guard for all processes', 'error');
            }
        } catch {
            showToast('Failed to toggle guard for all processes', 'error');
        }

        guardAllBtn.disabled = false;
        guardAllBtn.style.opacity = '';
        await loadProcessesFresh();
        mutationUntil = Date.now() + 3000;
    });

    // Group toggle removed — always-on directory grouping

    // ─── Keyboard Shortcuts ───
    function handleKeydown(e: KeyboardEvent) {
        // "/" to focus search (unless already in an input)
        if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault();
            searchInput?.focus();
            return;
        }
        if (e.key === 'Escape') {
            if (contextMenuEl) {
                closeContextMenu();
                return;
            }
            if (drawer?.classList.contains('open')) {
                closeDrawer();
            } else {
                closeModal();
            }
            // Blur search on escape
            if (document.activeElement === searchInput) {
                searchInput?.blur();
            }
        }
    }
    document.addEventListener('keydown', handleKeydown);

    // ─── SSE Live Updates (replaces polling) ───
    let eventSource: EventSource | null = null;
    let logRefreshTimer: ReturnType<typeof setInterval> | null = null;
    let sseThrottleTimer: ReturnType<typeof setTimeout> | null = null;

    function connectSSE() {
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (event) => {
            // Skip SSE updates briefly after mutations to avoid flicker
            if (Date.now() < mutationUntil) return;
            try {
                allProcesses = JSON.parse(event.data);
                // Throttle table re-renders to avoid lag on rapid SSE
                if (!sseThrottleTimer) {
                    sseThrottleTimer = setTimeout(() => {
                        sseThrottleTimer = null;
                        renderFilteredProcesses();
                        updateStats(allProcesses);
                    }, 2000);
                }
            } catch { /* invalid data, skip */ }
        };
        eventSource.onerror = () => {
            // SSE disconnected, reconnect after 5s
            eventSource?.close();
            eventSource = null;
            setTimeout(connectSSE, 5000);
        };
    }
    connectSSE();

    // Log drawer still needs periodic refresh (not part of SSE)
    logRefreshTimer = setInterval(() => {
        if (drawerProcess) refreshDrawerLogs();
    }, 5000);

    // ─── Cleanup ───
    return () => {
        $('drawer-close-btn')?.removeEventListener('click', closeDrawer);
        backdrop?.removeEventListener('click', closeDrawer);
        $('new-process-btn')?.removeEventListener('click', openModal);
        $('modal-close-btn')?.removeEventListener('click', closeModal);
        $('modal-cancel-btn')?.removeEventListener('click', closeModal);
        $('modal-create-btn')?.removeEventListener('click', createProcess);
        $('refresh-btn')?.removeEventListener('click', loadProcesses);
        document.removeEventListener('keydown', handleKeydown);
        closeContextMenu();
        if (eventSource) eventSource.close();
        if (logRefreshTimer) clearInterval(logRefreshTimer);
        if (sseThrottleTimer) clearTimeout(sseThrottleTimer);
    };
}
