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

// ─── JSX Components ───

function ProcessRow({ p, animate }: { p: ProcessData; animate?: boolean }) {
    return (
        <tr data-process-name={p.name} className={animate ? 'animate-in' : ''} style={animate ? { opacity: '0' } : undefined}>
            <td>
                <div className="process-name">
                    <div className="process-icon">{p.name.charAt(0).toUpperCase()}</div>
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

function LogLine({ text }: { text: string }) {
    return <div className="log-line">{text}</div>;
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
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let isFetching = false;
    let isFirstLoad = true;
    let allProcesses: ProcessData[] = [];
    let searchQuery = '';
    let isGrouped = localStorage.getItem('bgr_grouped') === 'true'; // Persist preference
    let drawerProcess: string | null = null;
    let drawerTab: 'stdout' | 'stderr' = 'stdout';

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

        const tc = $('total-count');
        const rc = $('running-count');
        const sc = $('stopped-count');
        if (tc) tc.textContent = String(total);
        if (rc) rc.textContent = String(running);
        if (sc) sc.textContent = String(stopped);
    }

    function renderProcesses(processes: ProcessData[]) {
        const tbody = $('processes-table');
        if (!tbody) return;

        if (processes.length === 0) {
            tbody.replaceChildren(<EmptyState /> as unknown as Node);
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

    // ─── Action Handlers ───

    async function handleAction(e: Event) {
        const btn = (e.target as Element).closest('[data-action]') as HTMLElement;
        if (!btn) return;

        const action = btn.dataset.action;
        const name = btn.dataset.name;
        if (!name) return;

        switch (action) {
            case 'stop':
                try {
                    await fetch(`/api/stop/${encodeURIComponent(name)}`, { method: 'POST' });
                    showToast(`Stopped "${name}"`, 'success');
                    await loadProcesses();
                } catch (err: any) {
                    showToast(`Failed to stop "${name}"`, 'error');
                }
                break;

            case 'restart':
                try {
                    await fetch(`/api/restart/${encodeURIComponent(name)}`, { method: 'POST' });
                    showToast(`Restarted "${name}"`, 'success');
                    await loadProcesses();
                } catch (err: any) {
                    showToast(`Failed to restart "${name}"`, 'error');
                }
                break;

            case 'delete':
                try {
                    await fetch(`/api/processes/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    showToast(`Deleted "${name}"`, 'success');
                    if (drawerProcess === name) closeDrawer();
                    await loadProcesses();
                } catch (err: any) {
                    showToast(`Failed to delete "${name}"`, 'error');
                }
                break;

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

    // ─── Detail Drawer ───

    const drawer = $('detail-drawer');
    const backdrop = $('drawer-backdrop');

    function openDrawer(name: string) {
        drawerProcess = name;
        drawerTab = 'stdout';

        // Update header
        const nameEl = $('drawer-process-name');
        const iconEl = $('drawer-icon');
        if (nameEl) nameEl.textContent = name;
        if (iconEl) iconEl.textContent = name.charAt(0).toUpperCase();

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
            const lines = text.split('\n');

            if (lines.length === 0 || (lines.length === 1 && !lines[0])) {
                logsEl.replaceChildren(
                    <em style={{ color: 'var(--text-muted)' }}>No logs available</em> as unknown as Node
                );
            } else {
                const logElements = lines.map((line: string) => <LogLine text={line} /> as unknown as Node);
                logsEl.replaceChildren(...logElements);
            }
            logsEl.scrollTop = logsEl.scrollHeight;
        } catch {
            logsEl.replaceChildren(
                <em style={{ color: 'var(--text-muted)' }}>Failed to load logs</em> as unknown as Node
            );
        }
    }

    $('drawer-close-btn')?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);

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

    // ─── Auto-Refresh (5s polling, matching server cache TTL) ───
    loadProcesses();
    refreshTimer = setInterval(() => {
        loadProcesses();
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
        if (refreshTimer) clearInterval(refreshTimer);
    };
}
