/** @jsxImportSource react */
/**
 * bgrun Dashboard — Page Client Interactivity
 *
 * NOT a React component. A mount function that adds interactivity
 * to the server-rendered HTML. JSX here creates real DOM elements
 * (via Melina's jsx-dom runtime, not React virtual DOM).
 */

interface ProcessData {
    name: string;
    command: string;
    directory: string;
    pid: number;
    running: boolean;
    port: number | null;
    ports: number[];
    memory: number; // bytes
    group: string | null;
    runtime: string;
    timestamp: string;
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

// ─── JSX Components ───

function ProcessRow({ p, animate }: { p: ProcessData; animate?: boolean }) {
    return (
        <tr data-process-name={p.name} className={animate ? 'animate-in' : ''} style={animate ? { opacity: '0' } : undefined}>
            <td>
                <div className="process-name">
                    <span>{p.name}</span>
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
                    ? <span className="port-num">:{p.port}</span>
                    : <span style={{ color: 'var(--text-muted)' }}>–</span>
                }
            </td>
            <td className="memory">
                {p.memory > 0
                    ? <span className="memory-badge">{formatMemory(p.memory)}</span>
                    : <span style={{ color: 'var(--text-muted)' }}>–</span>
                }
            </td>
            <td className="command" title={p.command}>{p.command}</td>
            <td className="runtime">{formatRuntime(p.runtime)}</td>
            <td className="actions">
                <button className="action-btn info" data-action="logs" data-name={p.name} title="View Logs">
                    <LogsIcon />
                </button>
                {p.running
                    ? <button className="action-btn danger" data-action="stop" data-name={p.name} title="Stop">
                        <StopIcon />
                    </button>
                    : <button className="action-btn success" data-action="restart" data-name={p.name} title="Start">
                        <PlayIcon />
                    </button>
                }
                <button className="action-btn warning" data-action="restart" data-name={p.name} title="Restart">
                    <RestartIcon />
                </button>
                <button className="action-btn danger" data-action="delete" data-name={p.name} title="Delete">
                    <TrashIcon />
                </button>
            </td>
        </tr>
    );
}

function GroupHeader({ name }: { name: string }) {
    return (
        <tr className="group-header">
            <td colSpan={8}>
                <div className="group-label">
                    <span className="group-icon">📂</span>
                    {name}
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
    return (
        <div className="process-card" data-process-name={p.name}>
            <div className="card-header">
                <div className="process-name">
                    <span>{p.name}</span>
                </div>
                <span className={`status-badge ${p.running ? 'running' : 'stopped'}`}>
                    <span className="status-dot"></span>
                    {p.running ? 'Running' : 'Stopped'}
                </span>
            </div>
            <div className="card-details">
                <div className="card-detail"><span className="card-label">PID</span><span>{p.pid}</span></div>
                <div className="card-detail"><span className="card-label">Port</span><span>{p.port ? `:${p.port}` : '–'}</span></div>
                <div className="card-detail"><span className="card-label">Memory</span><span>{p.memory > 0 ? formatMemory(p.memory) : '–'}</span></div>
                <div className="card-detail"><span className="card-label">Runtime</span><span>{formatRuntime(p.runtime)}</span></div>
            </div>
            <div className="card-command" title={p.command}>{p.command}</div>
            <div className="card-actions">
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
    let isGrouped = localStorage.getItem('bgr_grouped') === 'true'; // Persist preference
    let drawerProcess: string | null = null;
    let drawerTab: 'stdout' | 'stderr' = 'stdout';
    let logAutoScroll = true;
    let logSearch = '';

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
        const totalMemory = processes.reduce((sum, p) => sum + (p.memory || 0), 0);

        const tc = $('total-count');
        const rc = $('running-count');
        const sc = $('stopped-count');
        const mc = $('memory-count');
        if (tc) tc.textContent = String(total);
        if (rc) rc.textContent = String(running);
        if (sc) sc.textContent = String(stopped);
        if (mc) mc.textContent = formatMemory(totalMemory) || '0 MB';
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

        if (isGrouped) {
            // Grouping Logic
            const groups: Record<string, ProcessData[]> = {};
            const ungrouped: ProcessData[] = [];

            processes.forEach(p => {
                if (p.group) {
                    if (!groups[p.group]) groups[p.group] = [];
                    groups[p.group].push(p);
                } else {
                    ungrouped.push(p);
                }
            });

            const nodes: Node[] = [];

            // Render groups first
            Object.keys(groups).sort().forEach(groupName => {
                nodes.push(<GroupHeader name={groupName} /> as unknown as Node);
                groups[groupName].forEach(p => {
                    nodes.push(<ProcessRow p={p} animate={animate} /> as unknown as Node);
                });
            });

            // Render ungrouped last (with header if groups exist)
            if (ungrouped.length > 0) {
                if (Object.keys(groups).length > 0) {
                    nodes.push(<GroupHeader name="Ungrouped" /> as unknown as Node);
                }
                ungrouped.forEach(p => {
                    nodes.push(<ProcessRow p={p} animate={animate} /> as unknown as Node);
                });
            }

            tbody.replaceChildren(...nodes);
        } else {
            // Standard List View
            const rows = processes.map(p => <ProcessRow p={p} animate={animate} /> as unknown as Node);
            tbody.replaceChildren(...rows);
        }

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
                break;
            }

            case 'logs':
                openDrawer(name);
                break;
        }
    }

    const tbody = $('processes-table');

    // Row click → open drawer
    tbody?.addEventListener('click', (e: Event) => {
        const btn = (e.target as Element).closest('[data-action]');
        if (btn) {
            handleAction(e);
            return;
        }
        const row = (e.target as Element).closest('tr[data-process-name]') as HTMLElement;
        if (row && row.dataset.processName) {
            openDrawer(row.dataset.processName);
        }
    });

    // Mobile cards click → same delegation
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

    // ─── Detail Drawer ───

    const drawer = $('detail-drawer');
    const backdrop = $('drawer-backdrop');

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
            const metaItems = [
                { label: 'Status', value: proc.running ? '● Running' : '○ Stopped' },
                { label: 'PID', value: String(proc.pid) },
                { label: 'Port', value: proc.port ? `:${proc.port}` : '–' },
                { label: 'Runtime', value: formatRuntime(proc.runtime) },
                { label: 'Command', value: proc.command },
                { label: 'Directory', value: proc.directory || '–' },
                { label: 'Memory', value: formatMemory(proc.memory) },
                { label: 'Group', value: proc.group || '–' },
            ];

            const items = metaItems.map(m => (
                <div className="meta-item">
                    <span className="meta-label">{m.label}</span>
                    <span className="meta-value">{m.value}</span>
                </div>
            ) as unknown as Node);
            meta.replaceChildren(...items);
        }

        // Update tab state
        drawer?.querySelectorAll('.drawer-tab').forEach(tab => {
            tab.classList.toggle('active', (tab as HTMLElement).dataset.tab === drawerTab);
        });

        // Show drawer
        drawer?.classList.add('open');
        backdrop?.classList.add('active');

        // Highlight table row
        tbody?.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
        const row = tbody?.querySelector(`tr[data-process-name="${name}"]`);
        if (row) row.classList.add('selected');

        refreshDrawerLogs();
    }

    function closeDrawer() {
        drawer?.classList.remove('open');
        backdrop?.classList.remove('active');
        drawerProcess = null;
        tbody?.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
    }

    async function refreshDrawerLogs() {
        if (!drawerProcess) return;
        const logsEl = $('drawer-logs');
        if (!logsEl) return;

        try {
            const res = await fetch(`/api/logs/${encodeURIComponent(drawerProcess)}`);
            const data = await res.json();
            const text = drawerTab === 'stdout' ? (data.stdout || '') : (data.stderr || '');
            const mtime = drawerTab === 'stdout' ? data.stdoutModified : data.stderrModified;
            const lines = text.split('\n');

            // Update file info bar with last-modified timestamp
            const infoEl = $('log-file-info');
            if (infoEl) {
                if (mtime) {
                    const ago = formatTimeAgo(new Date(mtime));
                    infoEl.innerHTML = `<span style="color:var(--text-muted)">Last updated:</span> <span style="color:var(--text-secondary)">${ago}</span>`;
                } else {
                    infoEl.textContent = '';
                }
            }

            if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
                logsEl.innerHTML = '<em style="color: var(--text-muted)">No logs available</em>';
            } else {
                const search = logSearch.toLowerCase();
                const html = lines.filter((line: string) => {
                    if (!search) return true;
                    return line.toLowerCase().includes(search);
                }).map((line: string) => {
                    return `<div class="log-line">${ansiToHtml(line)}</div>`;
                }).join('');
                logsEl.innerHTML = html;
            }
            if (logAutoScroll) {
                logsEl.scrollTop = logsEl.scrollHeight;
            }
        } catch {
            logsEl.innerHTML = '<em style="color: var(--text-muted)">Failed to load logs</em>';
        }
    }

    $('drawer-close-btn')?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);

    // Auto-scroll toggle
    const autoScrollBtn = $('log-autoscroll-btn');
    autoScrollBtn?.addEventListener('click', () => {
        logAutoScroll = !logAutoScroll;
        autoScrollBtn.classList.toggle('active', logAutoScroll);
        autoScrollBtn.textContent = logAutoScroll ? '↓' : '║';
        autoScrollBtn.title = logAutoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF';
        if (logAutoScroll) {
            const logsEl = $('drawer-logs');
            if (logsEl) logsEl.scrollTop = logsEl.scrollHeight;
        }
    });

    // Log search/filter with debounce
    let logSearchTimeout: ReturnType<typeof setTimeout> | null = null;
    $('log-search')?.addEventListener('input', (e) => {
        if (logSearchTimeout) clearTimeout(logSearchTimeout);
        logSearchTimeout = setTimeout(() => {
            logSearch = (e.target as HTMLInputElement).value;
            refreshDrawerLogs();
        }, 200);
    });

    // Tab switching
    drawer?.querySelectorAll('.drawer-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            drawerTab = (tab as HTMLElement).dataset.tab as 'stdout' | 'stderr';
            drawer.querySelectorAll('.drawer-tab').forEach(t => {
                t.classList.toggle('active', (t as HTMLElement).dataset.tab === drawerTab);
            });
            refreshDrawerLogs();
        });
    });

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

    const groupBtn = $('group-toggle-btn');
    function updateGroupBtnState() {
        if (groupBtn) {
            groupBtn.classList.toggle('active', isGrouped);
            groupBtn.style.color = isGrouped ? 'var(--accent-primary)' : '';
        }
    }
    updateGroupBtnState();

    groupBtn?.addEventListener('click', () => {
        isGrouped = !isGrouped;
        localStorage.setItem('bgr_grouped', String(isGrouped));
        updateGroupBtnState();
        renderFilteredProcesses();
    });

    // ─── Keyboard Shortcuts ───
    function handleKeydown(e: KeyboardEvent) {
        // "/" to focus search (unless already in an input)
        if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
            e.preventDefault();
            searchInput?.focus();
            return;
        }
        if (e.key === 'Escape') {
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

    function connectSSE() {
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (event) => {
            try {
                allProcesses = JSON.parse(event.data);
                renderFilteredProcesses();
                updateStats(allProcesses);
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
        if (eventSource) eventSource.close();
        if (logRefreshTimer) clearInterval(logRefreshTimer);
    };
}
