/**
 * bgrun Dashboard — Page Client Interactivity
 *
 * NOT a React component. A mount function that adds interactivity
 * to the server-rendered HTML. JSX creates real DOM elements via
 * Melina's jsx-dom runtime (mapped from react/jsx-runtime).
 */

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
                    {p.group && <span className="group-badge" title={`Group: ${p.group}`}>{p.group}</span>}
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
    let groupQuery = '';
    const deployPresetKey = 'bgr_deploy_concurrency_presets';
    const deployPresets = JSON.parse(localStorage.getItem(deployPresetKey) || '{}') as Record<string, number>;
    let deployConcurrency = Math.max(1, Math.min(4, parseInt(localStorage.getItem('bgr_deploy_concurrency') || '1') || 1));
    let searchDebounce: ReturnType<typeof setTimeout> | null = null;
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

    // ─── Virtual Scrolling State ───
    let LOG_LINE_HEIGHT = 22;       // default estimate, auto-calibrated on first render
    let logLineHeightCalibrated = false;
    const LOG_OVERSCAN = 10;        // extra lines rendered above/below viewport
    const VIRTUAL_THRESHOLD = 200;  // switch to virtual mode above this many lines
    let logVirtualActive = false;   // whether virtual scrolling is engaged
    let logFilteredIndices: number[] = []; // indices into logLinesRaw that pass the search filter
    let logScrollRAF: number | null = null; // rAF handle for throttled scroll

    /** Measure actual log line height from DOM on first render */
    function calibrateLogLineHeight(logsEl: HTMLElement) {
        if (logLineHeightCalibrated) return;
        const firstLine = logsEl.querySelector('.log-line') as HTMLElement;
        if (firstLine) {
            const measured = firstLine.getBoundingClientRect().height;
            if (measured > 0) {
                LOG_LINE_HEIGHT = Math.round(measured);
                logLineHeightCalibrated = true;
            }
        }
    }

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

    const deployConcurrencySelect = $('deploy-concurrency-select') as HTMLSelectElement | null;
    const deployPresetResetBtn = $('deploy-preset-reset-btn') as HTMLButtonElement | null;
    const deployPresetSourceEl = $('deploy-preset-source');

    function getDeployPresetKey(group: string): string {
        return group ? `group:${group}` : '__all__';
    }

    function applyDeployConcurrencyPreset(group: string) {
        const preset = deployPresets[getDeployPresetKey(group)];
        const next = Math.max(1, Math.min(4, preset || parseInt(localStorage.getItem('bgr_deploy_concurrency') || '1') || 1));
        deployConcurrency = next;
        localStorage.setItem('bgr_deploy_concurrency', String(deployConcurrency));
        if (deployConcurrencySelect) deployConcurrencySelect.value = String(deployConcurrency);
    }

    function saveDeployConcurrencyPreset(group: string, concurrency: number) {
        deployPresets[getDeployPresetKey(group)] = concurrency;
        localStorage.setItem(deployPresetKey, JSON.stringify(deployPresets));
        localStorage.setItem('bgr_deploy_concurrency', String(concurrency));
        updateDeployPresetResetButton();
        updateDeployPresetScopes();
    }

    function resetDeployConcurrencyPreset(group: string) {
        delete deployPresets[getDeployPresetKey(group)];
        localStorage.setItem(deployPresetKey, JSON.stringify(deployPresets));
        applyDeployConcurrencyPreset(group);
        updateDeployPresetResetButton();
        updateDeployPresetScopes();
    }

    function updateDeployPresetIndicator() {
        const hasPreset = Object.prototype.hasOwnProperty.call(deployPresets, getDeployPresetKey(groupQuery));
        if (deployPresetSourceEl) {
            deployPresetSourceEl.textContent = hasPreset ? 'preset' : 'default';
            deployPresetSourceEl.classList.toggle('is-preset', hasPreset);
            deployPresetSourceEl.title = hasPreset
                ? `Using saved deploy preset for ${groupQuery || 'All Groups'}`
                : `Using default deploy concurrency for ${groupQuery || 'All Groups'}`;
        }
    }

    function updateDeployPresetResetButton() {
        if (!deployPresetResetBtn) return;
        const hasPreset = Object.prototype.hasOwnProperty.call(deployPresets, getDeployPresetKey(groupQuery));
        deployPresetResetBtn.disabled = !hasPreset;
        deployPresetResetBtn.style.opacity = hasPreset ? '' : '0.45';
        deployPresetResetBtn.title = hasPreset
            ? `Reset saved deploy preset for ${groupQuery || 'All Groups'}`
            : `No saved deploy preset for ${groupQuery || 'All Groups'}`;
        updateDeployPresetIndicator();
    }

    if (deployConcurrencySelect) {
        deployConcurrencySelect.value = String(deployConcurrency);
        deployConcurrencySelect.addEventListener('change', () => {
            deployConcurrency = Math.max(1, Math.min(4, parseInt(deployConcurrencySelect.value) || 1));
            saveDeployConcurrencyPreset(groupQuery, deployConcurrency);
        });
    }

    deployPresetResetBtn?.addEventListener('click', () => {
        resetDeployConcurrencyPreset(groupQuery);
        showToast(`Reset deploy preset for ${groupQuery || 'All Groups'}`, 'success');
        updateDeployAllButton();
    });
    updateDeployPresetResetButton();

    // ─── Guard Activity Feed ───
    interface GuardEvent {
        time: number;
        name: string;
        action: string;
        success: boolean;
    }

    async function loadGuardEvents() {
        const listEl = $('guard-activity-list');
        const emptyEl = $('guard-activity-empty');
        if (!listEl) return;
        try {
            const res = await fetch('/api/guard-events');
            const events: GuardEvent[] = await res.json();
            if (events.length === 0) {
                if (emptyEl) emptyEl.style.display = '';
                listEl.innerHTML = '';
                return;
            }
            if (emptyEl) emptyEl.style.display = 'none';
            listEl.replaceChildren(...events.slice(0, 10).map(ev => {
                const date = new Date(ev.time);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const icon = ev.success ? '↻' : '✕';
                const actionText = ev.action === 'restart' ? 'restarted' : ev.action;
                return (
                    <div className={`guard-event ${ev.success ? 'success' : 'failed'}`}>
                        <span className="guard-event-time">{timeStr}</span>
                        <span className="guard-event-icon">{icon}</span>
                        <span className="guard-event-name">{ev.name}</span>
                        <span className="guard-event-action">{actionText}</span>
                    </div>
                ) as unknown as Node;
            }));
        } catch {
            if (emptyEl) emptyEl.style.display = '';
        }
    }
    loadGuardEvents();
    setInterval(loadGuardEvents, 10000); // Refresh every 10s

    // ─── Load & Render Processes ───

    async function loadProcesses() {
        if (isFetching) return;
        isFetching = true;
        try {
            const res = await fetch('/api/processes');
            allProcesses = await res.json();
            updateGroupFilter();
            renderFilteredProcesses();
            updateStats(allProcesses);
        } catch (err) {
            console.error('[bgr-dashboard] loadProcesses error:', err);
        } finally {
            isFetching = false;
        }
    }

    function updateDeployPresetScopes() {
        const scopesEl = $('deploy-preset-scopes');
        if (!scopesEl) return;

        const allGroups = new Set(allProcesses.map(p => p.group).filter(Boolean) as string[]);
        const presetKeys = Object.keys(deployPresets);
        const visibleScopes = presetKeys
            .map(key => key === '__all__' ? '' : key.replace(/^group:/, ''))
            .filter(scope => scope === '' || allGroups.has(scope));

        if (visibleScopes.length === 0) {
            scopesEl.innerHTML = '';
            return;
        }

        scopesEl.replaceChildren(
            ...visibleScopes.map(scope => (
                <button
                    className={`deploy-preset-scope ${scope === groupQuery ? 'active' : ''}`}
                    data-action="switch-preset-scope"
                    data-scope={scope}
                    title={scope ? `Switch to group ${scope}` : 'Switch to All Groups'}
                >
                    {scope || 'All'}
                </button>
            ) as unknown as Node)
        );
    }

    function updateGroupFilter() {
        const groupFilter = $('group-filter') as HTMLSelectElement;
        if (!groupFilter) return;
        const groups = new Set<string>();
        for (const p of allProcesses) {
            if (p.group) groups.add(p.group);
        }
        const currentValue = groupFilter.value;
        groupFilter.replaceChildren(
            <option value="">All Groups</option> as unknown as Node,
            ...Array.from(groups).sort().map(g => <option value={g}>{g}</option> as unknown as Node)
        );
        // Preserve selection if still valid
        if (currentValue && groups.has(currentValue)) {
            groupFilter.value = currentValue;
        } else if (currentValue && !groups.has(currentValue)) {
            groupFilter.value = '';
            groupQuery = '';
        }
        applyDeployConcurrencyPreset(groupFilter.value || '');
        updateDeployPresetScopes();
    }

    function renderFilteredProcesses() {
        // Always sync searchQuery from DOM to prevent desync
        if (searchInput && searchInput.value.toLowerCase().trim() !== searchQuery) {
            searchQuery = searchInput.value.toLowerCase().trim();
        }
        // Sync groupQuery from dropdown
        const groupFilter = $('group-filter') as HTMLSelectElement;
        if (groupFilter && groupFilter.value !== groupQuery) {
            groupQuery = groupFilter.value;
        }
        let filtered = searchQuery
            ? allProcesses.filter(p =>
                p.name.toLowerCase().includes(searchQuery) ||
                p.command.toLowerCase().includes(searchQuery) ||
                (p.port && String(p.port).includes(searchQuery))
            )
            : allProcesses;
        // Apply group filter
        if (groupQuery) {
            filtered = filtered.filter(p => p.group === groupQuery);
        }
        renderProcesses(filtered);
        updateDeployAllButton();

        // Update search result count badge
        const badge = $('search-count');
        if (badge) {
            if (searchQuery) {
                badge.textContent = `${filtered.length}/${allProcesses.length}`;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    function updateDeployAllButton() {
        const btn = $('deploy-all-btn') as HTMLButtonElement;
        const label = $('deploy-all-label');
        if (!btn || !label) return;

        const targetCount = allProcesses.filter(p => {
            if (p.name === 'bgr-dashboard' || p.name === 'bgr-guard') return false;
            if (groupQuery && p.group !== groupQuery) return false;
            return true;
        }).length;

        if (groupQuery) {
            label.textContent = `Deploy Group (${targetCount})`;
            btn.title = `Git pull + restart deployable processes in group "${groupQuery}" with preset ${deployConcurrency}×`;
        } else {
            label.textContent = `Deploy All (${targetCount})`;
            btn.title = `Git pull + restart all deployable processes with preset ${deployConcurrency}×`;
        }

        btn.disabled = targetCount === 0;
        btn.style.opacity = targetCount === 0 ? '0.5' : '';
        updateDeployPresetResetButton();
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

    function toggleGroup(groupDir: string) {
        if (collapsedGroups.has(groupDir)) {
            collapsedGroups.delete(groupDir);
        } else {
            collapsedGroups.add(groupDir);
        }
        localStorage.setItem('bgr_collapsed_groups', JSON.stringify([...collapsedGroups]));
        renderFilteredProcesses();
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

        const sortedGroupKeys = Object.keys(groups).sort();

        // Build DOM nodes for table rows
        const rows: Node[] = [];
        sortedGroupKeys.forEach(groupDir => {
            const procs = groups[groupDir];
            const running = procs.filter(p => p.running).length;
            const collapsed = collapsedGroups.has(groupDir);
            rows.push(<GroupHeader name={groupDir} running={running} total={procs.length} collapsed={collapsed} /> as unknown as Node);
            if (!collapsed) {
                procs.forEach(p => {
                    rows.push(<ProcessRow p={p} animate={animate} /> as unknown as Node);
                });
            }
        });

        // Replace tbody contents with new DOM nodes
        tbody.replaceChildren(...rows);

        // Add click handlers for group headers (toggle collapse)
        tbody.querySelectorAll('.group-header').forEach(header => {
            header.addEventListener('click', (e: Event) => {
                if ((e.target as Element).closest('[data-action]')) return;
                const groupName = (header as HTMLElement).dataset.groupName;
                if (!groupName) return;
                toggleGroup(groupName);
            });
        });

        // Render mobile cards
        if (cardsEl) {
            cardsEl.replaceChildren(...processes.map(p => <ProcessCard p={p} /> as unknown as Node));
        }

        if (isFirstLoad) isFirstLoad = false;

        // Restore selected row + keyboard focus row
        if (drawerProcess) {
            const finalTbody = $('processes-table') || tbody;
            const row = finalTbody.querySelector(`tr[data-process-name="${drawerProcess}"]`);
            if (row) row.classList.add('selected');
        }
        // Restore keyboard focus ring if user had a row focused
        if (focusedProcessName) {
            const finalTbody = $('processes-table') || tbody;
            const focusRow = finalTbody.querySelector(`tr[data-process-name="${focusedProcessName}"]`);
            if (focusRow) focusRow.classList.add('focus-ring');
        }
    }

    // ─── Search (debounced 150ms) ───

    const searchInput = $('search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', () => {
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            searchQuery = searchInput.value.toLowerCase().trim();
            renderFilteredProcesses();
        }, 150);
    });

    // ─── Group Filter ───

    const groupFilter = $('group-filter') as HTMLSelectElement;
    groupFilter?.addEventListener('change', () => {
        groupQuery = groupFilter.value;
        applyDeployConcurrencyPreset(groupQuery);
        updateDeployPresetResetButton();
        renderFilteredProcesses();
    });

    $('deploy-preset-scopes')?.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('[data-action="switch-preset-scope"]') as HTMLElement | null;
        const scope = btn?.dataset.scope;
        if (scope === undefined) return;

        const groupFilter = $('group-filter') as HTMLSelectElement | null;
        if (groupFilter) {
            groupFilter.value = scope;
        }
        groupQuery = scope;
        applyDeployConcurrencyPreset(groupQuery);
        updateDeployPresetResetButton();
        renderFilteredProcesses();
        showToast(`Switched to ${scope || 'All Groups'} preset`, 'info');
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
        logVirtualActive = false;
        logFilteredIndices = [];
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


    // ─── Build filtered indices ───
    function rebuildFilteredIndices() {
        const search = logSearch.toLowerCase();
        logFilteredIndices = [];
        for (let i = 0; i < logLinesRaw.length; i++) {
            if (search && !logLinesRaw[i].toLowerCase().includes(search)) continue;
            logFilteredIndices.push(i);
        }
    }

    // ─── Render a single log line HTML string ───
    function renderLogLineHtml(rawIndex: number): string {
        const num = rawIndex + 1;
        return `<div class="log-line" data-ln="${num}"><span class="log-line-num">${num}</span><span class="log-line-content">${logLinesHtml[rawIndex]}</span></div>`;
    }

    // ─── Virtual scroll: render only visible slice ───
    function virtualRenderSlice(logsEl: HTMLElement) {
        const count = logFilteredIndices.length;
        if (count === 0) {
            logsEl.innerHTML = '<em style="color: var(--text-muted)">No logs available</em>';
            return;
        }

        const totalHeight = count * LOG_LINE_HEIGHT;
        const scrollTop = logsEl.scrollTop;
        const viewportH = logsEl.clientHeight;

        // Calculate visible range with overscan
        let startIdx = Math.floor(scrollTop / LOG_LINE_HEIGHT) - LOG_OVERSCAN;
        let endIdx = Math.ceil((scrollTop + viewportH) / LOG_LINE_HEIGHT) + LOG_OVERSCAN;
        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(count - 1, endIdx);

        // Only rebuild if the visible range actually changed
        const topSpacer = logsEl.querySelector('.log-virtual-top') as HTMLElement;
        if (topSpacer && topSpacer.dataset.start === String(startIdx) && topSpacer.dataset.end === String(endIdx)) {
            return; // same range, skip DOM work
        }

        const topH = startIdx * LOG_LINE_HEIGHT;
        const bottomH = Math.max(0, (count - endIdx - 1) * LOG_LINE_HEIGHT);

        // Build visible lines
        const chunks: string[] = [];
        chunks.push(`<div class="log-virtual-top" data-start="${startIdx}" data-end="${endIdx}" style="height:${topH}px"></div>`);
        for (let i = startIdx; i <= endIdx; i++) {
            chunks.push(renderLogLineHtml(logFilteredIndices[i]));
        }
        chunks.push(`<div class="log-virtual-bottom" style="height:${bottomH}px"></div>`);
        logsEl.innerHTML = chunks.join('');
    }

    // ─── Scroll handler for virtual mode ───
    function onLogScroll() {
        if (!logVirtualActive) return;
        if (logScrollRAF) return; // already scheduled
        logScrollRAF = requestAnimationFrame(() => {
            logScrollRAF = null;
            const logsEl = $('drawer-logs') as HTMLElement;
            if (logsEl) virtualRenderSlice(logsEl);
        });
    }

    function fullRebuildLogs(logsEl: HTMLElement) {
        const search = logSearch.toLowerCase();
        if (logLinesRaw.length === 0 || (logLinesRaw.length === 1 && !logLinesRaw[0])) {
            logsEl.innerHTML = '<em style="color: var(--text-muted)">No logs available</em>';
            updateLogCount(0);
            logNeedsFullRebuild = false;
            logVirtualActive = false;
            return;
        }

        // Rebuild filtered indices
        rebuildFilteredIndices();
        const count = logFilteredIndices.length;
        updateLogCount(count);

        // Decide: virtual or direct
        if (count >= VIRTUAL_THRESHOLD) {
            logVirtualActive = true;
            virtualRenderSlice(logsEl);
        } else {
            logVirtualActive = false;
            // Direct render — small enough for full DOM
            const chunks: string[] = [];
            for (const idx of logFilteredIndices) {
                chunks.push(renderLogLineHtml(idx));
            }
            logsEl.innerHTML = chunks.join('');
        }
        logNeedsFullRebuild = false;

        // Auto-calibrate line height from first rendered line
        if (!logLineHeightCalibrated) {
            requestAnimationFrame(() => calibrateLogLineHeight(logsEl));
        }
    }

    function appendNewLogLines(logsEl: HTMLElement, startIndex: number) {
        const search = logSearch.toLowerCase();

        // Append to filtered indices
        for (let i = startIndex; i < logLinesRaw.length; i++) {
            if (search && !logLinesRaw[i].toLowerCase().includes(search)) continue;
            logFilteredIndices.push(i);
        }
        const count = logFilteredIndices.length;
        updateLogCount(count);

        // Check if we need to switch to virtual mode
        if (count >= VIRTUAL_THRESHOLD && !logVirtualActive) {
            logVirtualActive = true;
            virtualRenderSlice(logsEl);
            return;
        }

        if (logVirtualActive) {
            // In virtual mode, re-render the current visible slice
            virtualRenderSlice(logsEl);
        } else {
            // Direct DOM append for small logs
            const fragment = document.createDocumentFragment();
            for (let i = startIndex; i < logLinesRaw.length; i++) {
                if (search && !logLinesRaw[i].toLowerCase().includes(search)) continue;
                const div = document.createElement('div');
                div.className = 'log-line';
                div.setAttribute('data-ln', String(i + 1));
                div.innerHTML = `<span class="log-line-num">${i + 1}</span><span class="log-line-content">${logLinesHtml[i]}</span>`;
                fragment.appendChild(div);
            }
            if (fragment.childNodes.length > 0) logsEl.appendChild(fragment);
        }
    }

    function updateLogCount(count: number) {
        const countEl = $('log-line-count');
        if (countEl) {
            const suffix = logVirtualActive ? ' (virtual)' : '';
            countEl.textContent = `${count} line${count !== 1 ? 's' : ''}${suffix}`;
        }
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

    // Virtual scroll handler — drives re-render on scroll in virtual mode
    logsContainer?.addEventListener('scroll', onLogScroll, { passive: true });

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

    // ─── Templates Modal ───

    interface TemplateData {
        name: string;
        command: string;
        workdir: string;
        env: string;
        group: string;
        created_at: string;
    }

    let templates: TemplateData[] = [];

    async function loadTemplates() {
        try {
            const res = await fetch('/api/templates');
            if (res.ok) {
                templates = await res.json();
                renderTemplates();
            }
        } catch (err) {
            console.error('[bgr-dashboard] loadTemplates error:', err);
        }
    }

    function renderTemplates() {
        const list = $('templates-list');
        if (!list) return;

        if (templates.length === 0) {
            list.innerHTML = '<div class="templates-empty">No templates saved yet</div>';
            return;
        }

        list.replaceChildren(...templates.map(t => (
            <div className="template-item">
                <div className="template-item-info">
                    <div className="template-item-name">{t.name}</div>
                    <div className="template-item-command">{t.command}</div>
                </div>
                {t.group && <span className="template-item-group">{t.group}</span>}
                <div className="template-item-actions">
                    <button className="use-btn" data-use={t.name} title="Use this template">Use</button>
                    <button className="delete-btn" data-delete={t.name} title="Delete template">✕</button>
                </div>
            </div>
        ) as unknown as Node));

        // Add click handlers
        list.querySelectorAll('.use-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = (e.target as HTMLElement).dataset.use;
                const tmpl = templates.find(t => t.name === name);
                if (tmpl) {
                    useTemplate(tmpl);
                }
            });
        });

        list.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = (e.target as HTMLElement).dataset.delete;
                if (name) deleteTemplate(name);
            });
        });
    }

    function openTemplatesModal() {
        const modal = $('templates-modal');
        if (modal) modal.classList.add('active');
        loadTemplates();
    }

    function closeTemplatesModal() {
        const modal = $('templates-modal');
        if (modal) modal.classList.remove('active');
        // Clear form
        ($('template-name') as HTMLInputElement).value = '';
        ($('template-command') as HTMLInputElement).value = '';
        ($('template-directory') as HTMLInputElement).value = '';
        ($('template-group') as HTMLInputElement).value = '';
        ($('template-env') as HTMLInputElement).value = '';
    }

    async function saveTemplate() {
        const name = ($('template-name') as HTMLInputElement)?.value?.trim();
        const command = ($('template-command') as HTMLInputElement)?.value?.trim();
        const workdir = ($('template-directory') as HTMLInputElement)?.value?.trim();
        const group = ($('template-group') as HTMLInputElement)?.value?.trim();
        const env = ($('template-env') as HTMLInputElement)?.value?.trim();

        if (!name || !command) {
            showToast('Name and command are required', 'error');
            return;
        }

        try {
            const res = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, command, workdir, group, env }),
            });

            if (res.ok) {
                showToast(`Template "${name}" saved`, 'success');
                loadTemplates();
                // Clear form
                ($('template-name') as HTMLInputElement).value = '';
                ($('template-command') as HTMLInputElement).value = '';
                ($('template-directory') as HTMLInputElement).value = '';
                ($('template-group') as HTMLInputElement).value = '';
                ($('template-env') as HTMLInputElement).value = '';
            } else {
                showToast('Failed to save template', 'error');
            }
        } catch (err) {
            showToast('Failed to save template', 'error');
        }
    }

    async function deleteTemplate(name: string) {
        if (!confirm(`Delete template "${name}"?`)) return;

        try {
            const res = await fetch(`/api/templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (res.ok) {
                showToast(`Template "${name}" deleted`, 'success');
                loadTemplates();
            } else {
                showToast('Failed to delete template', 'error');
            }
        } catch (err) {
            showToast('Failed to delete template', 'error');
        }
    }

    function useTemplate(tmpl: TemplateData) {
        // Fill new process form with template values
        ($('process-name-input') as HTMLInputElement).value = '';
        ($('process-command-input') as HTMLInputElement).value = tmpl.command;
        ($('process-directory-input') as HTMLInputElement).value = tmpl.workdir;
        closeTemplatesModal();
        openModal();
        showToast(`Template "${tmpl.name}" loaded — enter a process name`, 'success');
    }

    $('templates-btn')?.addEventListener('click', openTemplatesModal);
    $('templates-modal-close')?.addEventListener('click', closeTemplatesModal);
    $('template-save-btn')?.addEventListener('click', saveTemplate);
    $('templates-modal')?.addEventListener('click', (e) => {
        if ((e.target as Element).classList.contains('modal-overlay')) {
            closeTemplatesModal();
        }
    });

    // ─── History Modal ───

    interface HistoryEntry {
        process_name: string;
        event: string;
        pid: number | null;
        timestamp: string;
        metadata: Record<string, any>;
    }

    interface DeployResultEntry {
        name: string;
        ok: boolean;
        skipped?: boolean;
        reason?: string;
        pullOutput?: string;
        installOutput?: string;
        packageManager?: string | null;
        installCommand?: string;
        installAttempted?: boolean;
        retrying?: boolean;
        phase?: 'pending' | 'running' | 'done';
    }

    let allHistory: HistoryEntry[] = [];
    let latestDeployResults: DeployResultEntry[] = [];
    let latestDeploySummary: { group?: string | null; deployed?: number; skipped?: number; failed?: number; total?: number } | undefined;

    async function loadHistory() {
        try {
            const res = await fetch('/api/history?limit=100');
            if (res.ok) {
                allHistory = await res.json();
                renderHistory();
                updateHistoryFilters();
            }
        } catch (err) {
            console.error('[bgr-dashboard] loadHistory error:', err);
        }
    }

    function updateHistoryFilters() {
        const processFilter = $('history-process-filter') as HTMLSelectElement;
        const eventFilter = $('history-event-filter') as HTMLSelectElement;
        if (!processFilter) return;

        const processNames = new Set<string>();
        for (const h of allHistory) {
            processNames.add(h.process_name);
        }

        const currentValue = processFilter.value;
        processFilter.replaceChildren(
            <option value="">All Processes</option> as unknown as Node,
            ...Array.from(processNames).sort().map(n => <option value={n}>{n}</option> as unknown as Node)
        );
        if (currentValue && processNames.has(currentValue)) {
            processFilter.value = currentValue;
        }
    }

    function formatHistoryDetails(h: HistoryEntry): Array<{ label: string; value: string; copyable?: boolean }> {
        const md = h.metadata || {};
        const parts: Array<{ label: string; value: string; copyable?: boolean }> = [];

        if (h.event === 'deploy') {
            if (md.packageManager) parts.push({ label: 'pm', value: String(md.packageManager) });
            if (md.installCommand) parts.push({ label: 'install', value: String(md.installCommand), copyable: true });
            else if (md.installed === false) parts.push({ label: 'install', value: 'skipped' });
            if (md.directory) parts.push({ label: 'dir', value: String(md.directory), copyable: true });
        } else {
            if (md.by) parts.push({ label: 'by', value: String(md.by) });
            if (md.count !== undefined) parts.push({ label: 'count', value: String(md.count) });
            if (md.directory) parts.push({ label: 'dir', value: String(md.directory), copyable: true });
        }

        return parts;
    }

    function renderHistory() {
        const list = $('history-list');
        const processFilter = $('history-process-filter') as HTMLSelectElement;
        const eventFilter = $('history-event-filter') as HTMLSelectElement;
        const metadataFilter = $('history-metadata-filter') as HTMLInputElement;
        if (!list) return;

        const processValue = processFilter?.value || '';
        const eventValue = eventFilter?.value || '';
        const metadataTerms = (metadataFilter?.value || '')
            .split(',')
            .map(v => v.toLowerCase().trim())
            .filter(Boolean);

        let filtered = allHistory;
        if (processValue) {
            filtered = filtered.filter(h => h.process_name === processValue);
        }
        if (eventValue) {
            filtered = filtered.filter(h => h.event === eventValue);
        }
        if (metadataTerms.length > 0) {
            filtered = filtered.filter(h => {
                const details = formatHistoryDetails(h);
                return metadataTerms.every(term =>
                    details.some(detail =>
                        detail.label.toLowerCase().includes(term) ||
                        detail.value.toLowerCase().includes(term)
                    )
                );
            });
        }

        if (filtered.length === 0) {
            list.innerHTML = '<div class="history-empty">No history found</div>';
            return;
        }

        list.replaceChildren(...filtered.map(h => {
            const time = new Date(h.timestamp);
            const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + time.toLocaleDateString([], { month: 'short', day: 'numeric' });
            const details = formatHistoryDetails(h);
            return (
                <div className="history-item">
                    <span className="history-item-time">{timeStr}</span>
                    <span className="history-item-process">{h.process_name}</span>
                    <span className={`history-item-event ${h.event}`}>{h.event.replace('_', ' ')}</span>
                    {h.pid && <span className="history-item-pid">PID {h.pid}</span>}
                    {details.length > 0 && (
                        <details className="history-item-details-wrap">
                            <summary className="history-item-details-summary">
                                <span>Details</span>
                                <span className="history-item-details-count">{details.length}</span>
                            </summary>
                            <div className="history-item-details">
                                {details.map(detail => (
                                    <span className="history-item-detail">
                                        <button
                                            className="history-item-detail-text history-item-filter-chip"
                                            data-action="filter-history-detail"
                                            data-filter={detail.value}
                                            title={`Filter history by ${detail.label}: ${detail.value}`}
                                        >
                                            {detail.label}: {detail.value}
                                        </button>
                                        {detail.copyable && (
                                            <button
                                                className="history-item-copy"
                                                data-action="copy-history-detail"
                                                data-copy={detail.value}
                                                title={`Copy ${detail.label}`}
                                            >
                                                Copy
                                            </button>
                                        )}
                                    </span>
                                ) as unknown as Node)}
                            </div>
                        </details>
                    )}
                </div>
            ) as unknown as Node;
        }));
    }

    function openHistoryModal() {
        const modal = $('history-modal');
        if (modal) modal.classList.add('active');
        loadHistory();
    }

    function closeHistoryModal() {
        const modal = $('history-modal');
        if (modal) modal.classList.remove('active');
    }

    $('history-btn')?.addEventListener('click', openHistoryModal);
    $('history-modal-close')?.addEventListener('click', closeHistoryModal);
    $('history-modal')?.addEventListener('click', (e) => {
        if ((e.target as Element).classList.contains('modal-overlay')) {
            closeHistoryModal();
        }
    });
    $('history-process-filter')?.addEventListener('change', renderHistory);
    $('history-event-filter')?.addEventListener('change', renderHistory);
    $('history-metadata-filter')?.addEventListener('input', renderHistory);
    $('history-list')?.addEventListener('click', async (e) => {
        const target = e.target as Element;
        const copyBtn = target.closest('[data-action="copy-history-detail"]') as HTMLElement | null;
        if (copyBtn) {
            const value = copyBtn.dataset.copy;
            if (!value) return;
            try {
                await navigator.clipboard.writeText(value);
                showToast('Copied to clipboard', 'success');
            } catch {
                showToast('Failed to copy', 'error');
            }
            return;
        }

        const filterBtn = target.closest('[data-action="filter-history-detail"]') as HTMLElement | null;
        if (filterBtn) {
            const value = filterBtn.dataset.filter || '';
            const input = $('history-metadata-filter') as HTMLInputElement | null;
            if (!input) return;
            const existing = input.value
                .split(',')
                .map(v => v.trim())
                .filter(Boolean);
            if (!existing.some(v => v.toLowerCase() === value.toLowerCase())) {
                existing.push(value);
            }
            input.value = existing.join(', ');
            renderHistory();
            showToast(`Added history filter "${value}"`, 'info');
        }
    });

    // ─── Deploy Results Modal ───

    function renderDeployResults(summary?: { group?: string | null; deployed?: number; skipped?: number; failed?: number; total?: number }) {
        const summaryEl = $('deploy-results-summary');
        const listEl = $('deploy-results-list');
        if (!summaryEl || !listEl) return;

        latestDeploySummary = summary || latestDeploySummary;

        if (latestDeploySummary) {
            const deployed = latestDeployResults.filter(r => r.ok).length;
            const skipped = latestDeployResults.filter(r => !r.ok && r.skipped && r.phase === 'done').length;
            const failed = latestDeployResults.filter(r => !r.ok && !r.skipped && r.phase === 'done').length;
            const running = latestDeployResults.filter(r => r.phase === 'running').length;
            const pending = latestDeployResults.filter(r => r.phase === 'pending').length;
            const scope = latestDeploySummary.group ? `Group: ${latestDeploySummary.group}` : 'All deployable processes';
            summaryEl.innerHTML = [
                `<span><strong>${scope}</strong></span>`,
                `<span>mode ${deployConcurrency}×</span>`,
                `<span>${deployed} deployed</span>`,
                `<span>${skipped} skipped</span>`,
                `<span>${failed} failed</span>`,
                `<span>${running} running</span>`,
                `<span>${pending} pending</span>`,
                `<span>${latestDeployResults.length || latestDeploySummary.total || 0} total</span>`,
            ].join('');
        } else {
            summaryEl.textContent = 'No deploy results yet';
        }

        if (latestDeployResults.length === 0) {
            listEl.innerHTML = '<div class="history-empty">Run a bulk deploy to see detailed results</div>';
            return;
        }

        listEl.replaceChildren(...latestDeployResults.map(result => {
            const statusClass = result.phase === 'running'
                ? 'running'
                : result.phase === 'pending'
                    ? 'pending'
                    : result.ok
                        ? 'ok'
                        : result.skipped
                            ? 'skipped'
                            : 'failed';
            const statusLabel = result.phase === 'running'
                ? 'Deploying…'
                : result.phase === 'pending'
                    ? 'Pending'
                    : result.ok
                        ? 'Deployed'
                        : result.skipped
                            ? 'Skipped'
                            : 'Failed';
            const details = [result.reason, result.pullOutput, result.installOutput].filter(Boolean).join('\n\n');

            return (
                <div className={`deploy-result-item ${statusClass}`}>
                    <div className="deploy-result-head">
                        <span className="deploy-result-name">{result.name}</span>
                        <div className="deploy-result-head-right">
                            <span className={`deploy-result-status ${statusClass}`}>{statusLabel}</span>
                            {!result.ok && result.phase !== 'pending' && result.phase !== 'running' && (
                                <button className="btn btn-ghost btn-sm deploy-retry-btn" data-action="deploy-retry" data-name={result.name} disabled={result.retrying ? true : undefined}>
                                    {result.retrying ? 'Retrying…' : 'Retry'}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="deploy-result-meta">
                        <span><strong>Package manager:</strong> {result.packageManager || 'none'}</span>
                        <span><strong>Install step:</strong> {result.installAttempted ? (result.installCommand || 'attempted') : 'skipped'}</span>
                    </div>
                    {result.reason && <div className="deploy-result-reason">{result.reason}</div>}
                    {(result.pullOutput || result.installOutput) && (
                        <details className="deploy-result-details">
                            <summary>Output</summary>
                            <pre>{details}</pre>
                        </details>
                    )}
                </div>
            ) as unknown as Node;
        }));
    }

    function openDeployResultsModal() {
        const modal = $('deploy-results-modal');
        if (modal) modal.classList.add('active');
    }

    function closeDeployResultsModal() {
        const modal = $('deploy-results-modal');
        if (modal) modal.classList.remove('active');
    }

    async function retryDeployResult(name: string) {
        const index = latestDeployResults.findIndex(r => r.name === name);
        if (index === -1) return;

        latestDeployResults[index] = { ...latestDeployResults[index], retrying: true, phase: 'running' };
        renderDeployResults();

        try {
            const res = await fetch(`/api/deploy/${encodeURIComponent(name)}`, { method: 'POST' });
            const data = await res.json();
            latestDeployResults[index] = {
                name,
                ok: !!res.ok,
                skipped: data.skipped,
                reason: res.ok ? undefined : (data.error || data.reason || `Failed to deploy '${name}'`),
                pullOutput: data.pullOutput || '',
                installOutput: data.installOutput || '',
                packageManager: data.packageManager || null,
                installCommand: data.installCommand || '',
                installAttempted: !!data.installAttempted,
                retrying: false,
                phase: 'done',
            };
            showToast(res.ok ? `Deployed "${name}" successfully` : `Retry failed for "${name}"`, res.ok ? 'success' : 'error');
        } catch {
            latestDeployResults[index] = {
                ...latestDeployResults[index],
                ok: false,
                skipped: false,
                reason: `Failed to deploy '${name}'`,
                retrying: false,
                phase: 'done',
            };
            showToast(`Retry failed for "${name}"`, 'error');
        }

        renderDeployResults();
        await loadProcessesFresh();
        mutationUntil = Date.now() + 5000;
    }

    $('deploy-results-modal-close')?.addEventListener('click', closeDeployResultsModal);
    $('deploy-results-modal')?.addEventListener('click', (e) => {
        if ((e.target as Element).classList.contains('modal-overlay')) {
            closeDeployResultsModal();
        }
    });
    $('deploy-results-list')?.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('[data-action="deploy-retry"]') as HTMLElement | null;
        const name = btn?.dataset.name;
        if (!name || btn?.hasAttribute('disabled')) return;
        retryDeployResult(name);
    });

    // ─── Toolbar Actions ───
    $('refresh-btn')?.addEventListener('click', () => {
        loadProcesses();
        if (drawerProcess) refreshDrawerLogs();
    });

    // ─── Shortcuts Button ───
    $('shortcuts-btn')?.addEventListener('click', toggleShortcutsOverlay);

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

    // ─── Deploy All Button ───
    $('deploy-all-btn')?.addEventListener('click', async () => {
        const deployAllBtn = $('deploy-all-btn') as HTMLButtonElement;
        if (!deployAllBtn || deployAllBtn.disabled) return;

        const targets = allProcesses.filter(p => {
            if (p.name === 'bgr-dashboard' || p.name === 'bgr-guard') return false;
            if (groupQuery && p.group !== groupQuery) return false;
            return true;
        });
        if (targets.length === 0) return;

        const scope = groupQuery ? `group "${groupQuery}"` : 'all deployable processes';
        const concurrency = Math.max(1, Math.min(4, deployConcurrency));
        deployAllBtn.disabled = true;
        deployAllBtn.style.opacity = '0.5';
        if (deployConcurrencySelect) deployConcurrencySelect.disabled = true;
        showToast(`Deploying ${scope} (${concurrency}×)...`, 'info');

        latestDeploySummary = { group: groupQuery || null, total: targets.length };
        latestDeployResults = targets.map(p => ({
            name: p.name,
            ok: false,
            skipped: false,
            reason: '',
            pullOutput: '',
            installOutput: '',
            packageManager: null,
            installCommand: '',
            installAttempted: false,
            phase: 'pending',
        }));
        renderDeployResults(latestDeploySummary);
        openDeployResultsModal();

        try {
            async function runDeployAtIndex(i: number) {
                const target = latestDeployResults[i];
                latestDeployResults[i] = { ...target, phase: 'running' };
                renderDeployResults();

                try {
                    const res = await fetch(`/api/deploy/${encodeURIComponent(target.name)}`, { method: 'POST' });
                    const data = await res.json();
                    latestDeployResults[i] = {
                        name: target.name,
                        ok: !!res.ok,
                        skipped: data.skipped,
                        reason: res.ok ? undefined : (data.error || data.reason || `Failed to deploy '${target.name}'`),
                        pullOutput: data.pullOutput || '',
                        installOutput: data.installOutput || '',
                        packageManager: data.packageManager || null,
                        installCommand: data.installCommand || '',
                        installAttempted: !!data.installAttempted,
                        phase: 'done',
                    };
                } catch {
                    latestDeployResults[i] = {
                        name: target.name,
                        ok: false,
                        skipped: false,
                        reason: `Failed to deploy '${target.name}'`,
                        pullOutput: '',
                        installOutput: '',
                        packageManager: null,
                        installCommand: '',
                        installAttempted: false,
                        phase: 'done',
                    };
                }
                renderDeployResults();
            }

            let cursor = 0;
            const workers = Array.from({ length: Math.min(concurrency, latestDeployResults.length) }, async () => {
                while (cursor < latestDeployResults.length) {
                    const current = cursor++;
                    await runDeployAtIndex(current);
                }
            });
            await Promise.all(workers);

            const deployed = latestDeployResults.filter(r => r.ok).length;
            const skipped = latestDeployResults.filter(r => !r.ok && r.skipped).length;
            const failed = latestDeployResults.filter(r => !r.ok && !r.skipped).length;
            const parts = [];
            if (deployed) parts.push(`${deployed} deployed`);
            if (skipped) parts.push(`${skipped} skipped`);
            if (failed) parts.push(`${failed} failed`);
            showToast(parts.length > 0 ? `Deploy complete: ${parts.join(', ')}` : 'Deploy complete', failed > 0 ? 'error' : 'success');
        } catch {
            showToast('Failed to deploy processes', 'error');
        }

        deployAllBtn.disabled = false;
        deployAllBtn.style.opacity = '';
        if (deployConcurrencySelect) deployConcurrencySelect.disabled = false;
        await loadProcessesFresh();
        mutationUntil = Date.now() + 5000;
    });

    // Group toggle removed — always-on directory grouping

    // ─── Keyboard Shortcuts ───
    let focusedProcessName: string | null = null;

    function getFocusableRows(): HTMLElement[] {
        const rows = tbody?.querySelectorAll('tr[data-process-name]') as NodeListOf<HTMLElement> | undefined;
        return rows ? Array.from(rows) : [];
    }

    function setProcessFocus(name: string | null) {
        // Remove previous focus
        tbody?.querySelectorAll('tr.keyboard-focus').forEach(r => r.classList.remove('keyboard-focus'));
        focusedProcessName = name;
        if (!name) return;
        const row = tbody?.querySelector(`tr[data-process-name="${name}"]`) as HTMLElement;
        if (row) {
            row.classList.add('keyboard-focus');
            row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    function navigateProcess(direction: 'up' | 'down') {
        const rows = getFocusableRows();
        if (rows.length === 0) return;

        if (!focusedProcessName) {
            // Nothing focused: pick first or last
            const target = direction === 'down' ? rows[0] : rows[rows.length - 1];
            setProcessFocus(target.dataset.processName || null);
            return;
        }

        const idx = rows.findIndex(r => r.dataset.processName === focusedProcessName);
        if (idx === -1) {
            setProcessFocus(rows[0].dataset.processName || null);
            return;
        }

        const nextIdx = direction === 'down'
            ? Math.min(idx + 1, rows.length - 1)
            : Math.max(idx - 1, 0);
        setProcessFocus(rows[nextIdx].dataset.processName || null);
    }

    /** Dispatch a process action by synthesizing a click on a virtual button */
    function dispatchAction(actionName: string, processName: string) {
        const fakeBtn = document.createElement('button');
        fakeBtn.dataset.action = actionName;
        fakeBtn.dataset.name = processName;
        // For guard toggle, read current state
        if (actionName === 'guard') {
            const proc = allProcesses.find(p => p.name === processName);
            fakeBtn.dataset.guarded = proc && isGuarded(proc) ? 'true' : 'false';
        }
        const fakeEvent = new MouseEvent('click');
        Object.defineProperty(fakeEvent, 'target', { value: fakeBtn });
        handleAction(fakeEvent);
    }

    function toggleShortcutsOverlay() {
        const overlay = $('shortcuts-overlay');
        if (overlay) overlay.classList.toggle('active');
    }

    $('shortcuts-close-btn')?.addEventListener('click', () => {
        $('shortcuts-overlay')?.classList.remove('active');
    });
    $('shortcuts-overlay')?.addEventListener('click', (e) => {
        if ((e.target as Element).classList.contains('shortcuts-overlay')) {
            $('shortcuts-overlay')?.classList.remove('active');
        }
    });

    function handleKeydown(e: KeyboardEvent) {
        // Skip all shortcuts when inside text inputs or textareas
        const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

        // "/" to focus search (unless already in an input)
        if (e.key === '/' && !inInput) {
            e.preventDefault();
            searchInput?.focus();
            return;
        }

        // Escape: close overlays progressively
        if (e.key === 'Escape') {
            const shortcutsOverlay = $('shortcuts-overlay');
            if (shortcutsOverlay?.classList.contains('active')) {
                shortcutsOverlay.classList.remove('active');
                return;
            }
            if (contextMenuEl) {
                closeContextMenu();
                return;
            }
            if (drawer?.classList.contains('open')) {
                closeDrawer();
            } else {
                closeModal();
            }
            // Clear keyboard focus
            setProcessFocus(null);
            // Blur search on escape
            if (document.activeElement === searchInput) {
                searchInput?.blur();
            }
            return;
        }

        // Remaining shortcuts only when NOT in inputs
        if (inInput) return;

        // Arrow navigation
        if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            navigateProcess('down');
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            navigateProcess('up');
            return;
        }

        // Enter: open drawer for focused process
        if (e.key === 'Enter' && focusedProcessName) {
            e.preventDefault();
            openDrawer(focusedProcessName);
            return;
        }

        // ? — help overlay
        if (e.key === '?') {
            e.preventDefault();
            toggleShortcutsOverlay();
            return;
        }

        // N — new process modal
        if (e.key === 'n' || e.key === 'N') {
            e.preventDefault();
            openModal();
            return;
        }

        // Process actions — require a focused row
        if (!focusedProcessName) return;

        if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            dispatchAction('restart', focusedProcessName);
            return;
        }
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            dispatchAction('stop', focusedProcessName);
            return;
        }
        if (e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            dispatchAction('guard', focusedProcessName);
            return;
        }
        if (e.key === 'd' || e.key === 'D') {
            e.preventDefault();
            dispatchAction('delete', focusedProcessName);
            // Clear focus since process is gone
            setProcessFocus(null);
            return;
        }
    }
    document.addEventListener('keydown', handleKeydown);

    // ─── SSE Live Updates (replaces polling) ───
    let eventSource: EventSource | null = null;
    let logRefreshTimer: ReturnType<typeof setInterval> | null = null;
    let sseThrottleTimer: ReturnType<typeof setTimeout> | null = null;
    let sseRetryDelay = 2_000;       // exponential backoff start
    const SSE_MAX_RETRY = 30_000;    // max 30s between retries

    // Initial data load — don't depend on SSE for first render
    loadProcesses();

    function connectSSE() {
        if (eventSource) { eventSource.close(); eventSource = null; }
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (event) => {
            sseRetryDelay = 2_000; // reset backoff on success
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
            // SSE disconnected — exponential backoff reconnect
            eventSource?.close();
            eventSource = null;
            setTimeout(connectSSE, sseRetryDelay);
            sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_RETRY);
        };
    }
    connectSSE();

    // Pause SSE when tab is hidden, resume when visible
    function handleVisibility() {
        if (document.hidden) {
            eventSource?.close();
            eventSource = null;
        } else {
            if (!eventSource) {
                sseRetryDelay = 2_000; // reset on manual re-focus
                connectSSE();
            }
        }
    }
    document.addEventListener('visibilitychange', handleVisibility);

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
        document.removeEventListener('visibilitychange', handleVisibility);
        closeContextMenu();
        if (eventSource) eventSource.close();
        if (logRefreshTimer) clearInterval(logRefreshTimer);
        if (sseThrottleTimer) clearTimeout(sseThrottleTimer);
        if (searchDebounce) clearTimeout(searchDebounce);
        if (logScrollRAF) cancelAnimationFrame(logScrollRAF);
        logsContainer?.removeEventListener('scroll', onLogScroll);
    };
}
