/**
 * BGR Dashboard — Home Page (Server Component)
 * 
 * Renders the page shell with loading placeholders.
 * Data is populated by page.client.tsx which polls /api/processes every 5s.
 */

export default function DashboardPage() {
    return (
        <div>
            {/* Toast Container */}
            <div className="toast-container" id="toast-container"></div>

            {/* Stats Grid */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Processes</div>
                    <div className="stat-value" id="total-count">–</div>
                </div>
                <div className="stat-card running">
                    <div className="stat-label">Running</div>
                    <div className="stat-value" id="running-count">–</div>
                </div>
                <div className="stat-card stopped">
                    <div className="stat-label">Stopped</div>
                    <div className="stat-value" id="stopped-count">–</div>
                </div>
                <div className="stat-card guarded">
                    <div className="stat-label">Guarded</div>
                    <div className="stat-value" id="guarded-count">–</div>
                </div>
                <div className="stat-card memory">
                    <div className="stat-label">Total Memory</div>
                    <div className="stat-value" id="memory-count">–</div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="toolbar">
                <div className="toolbar-left">
                    <div className="toolbar-brand">
                        <span className="toolbar-logo">⚡</span>
                        <h2>bgrun</h2>
                        <span className="version-badge" id="version-badge">...</span>
                    </div>
                    <div className="search-wrapper">
                        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input type="text" className="search-input" id="search-input" placeholder="Filter processes..." />
                        <span className="search-shortcut">/</span>
                    </div>
                </div>
                <div className="toolbar-right">
                    <button className="btn btn-ghost btn-icon" id="refresh-btn" title="Refresh">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                    </button>
                    <button className="btn btn-ghost btn-guard-all" id="guard-all-btn" title="Guard All Processes">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span id="guard-all-label">Guard All</span>
                    </button>
                    <button className="btn btn-primary" id="new-process-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Process
                    </button>
                </div>
            </div>

            {/* Process Table */}
            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style={{ width: '18%' }}>Process</th>
                            <th style={{ width: '90px' }}>Status</th>
                            <th style={{ width: '70px' }}>PID</th>
                            <th style={{ width: '70px' }}>Port</th>
                            <th style={{ width: '80px' }}>CPU</th>
                            <th style={{ width: '120px' }}>Memory</th>
                            <th>Command</th>
                            <th style={{ width: '100px' }}>Runtime</th>
                        </tr>
                    </thead>
                    <tbody id="processes-table">
                        <tr>
                            <td colSpan={7}>
                                <div className="empty-state">
                                    <div className="empty-icon">⚡</div>
                                    <h3>Loading processes...</h3>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Mobile Cards (shown on small screens, hidden on desktop) */}
            <div className="mobile-cards" id="mobile-cards"></div>

            {/* Detail Drawer Backdrop */}
            <div className="drawer-backdrop" id="drawer-backdrop"></div>

            {/* Detail Drawer */}
            <div className="detail-drawer" id="detail-drawer">
                <div className="drawer-resize-handle" id="drawer-resize-handle"></div>
                <div className="drawer-header">
                    <h3>
                        <span id="drawer-process-name">Process</span>
                    </h3>
                    <button className="drawer-close" id="drawer-close-btn">✕</button>
                </div>

                <div className="drawer-accordion">
                    {/* ─── Section 1: Info ─── */}
                    <div className="accordion-section" id="accordion-info">
                        <button className="accordion-trigger" data-section="info">
                            <svg className="accordion-chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                            <span>Info</span>
                        </button>
                        <div className="accordion-body">
                            <div className="drawer-meta" id="drawer-meta"></div>
                        </div>
                    </div>

                    {/* ─── Section 2: Config ─── */}
                    <div className="accordion-section" id="accordion-config">
                        <button className="accordion-trigger" data-section="config">
                            <svg className="accordion-chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                            <span>Config</span>
                        </button>
                        <div className="accordion-body">
                            <div className="accordion-subtabs" id="config-subtabs">
                                <button className="accordion-subtab active" data-subtab="toml">config.toml</button>
                                <button className="accordion-subtab" data-subtab="env">ENV</button>
                            </div>
                            <div className="accordion-sub-content" id="config-sub-content">
                                <div id="config-panel-toml">
                                    <div className="config-toolbar" id="config-toolbar">
                                        <span className="config-path" id="config-path"></span>
                                        <button className="btn btn-primary btn-sm" id="config-save-btn">Save &amp; Restart</button>
                                    </div>
                                    <textarea className="config-editor" id="config-editor" spellCheck={false}></textarea>
                                </div>
                                <div id="config-panel-env" style={{ display: 'none' }}>
                                    <div className="drawer-env" id="drawer-env"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ─── Section 3: Logs ─── */}
                    <div className="accordion-section open" id="accordion-logs">
                        <button className="accordion-trigger" data-section="logs">
                            <svg className="accordion-chevron" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" /></svg>
                            <span>Logs</span>
                        </button>
                        <div className="accordion-body accordion-body-logs">
                            <div className="accordion-subtabs" id="log-subtabs">
                                <button className="accordion-subtab active" data-subtab="stdout">stdout</button>
                                <button className="accordion-subtab" data-subtab="stderr">
                                    stderr
                                    <span className="stderr-badge" id="stderr-badge" style={{ display: 'none' }}>0</span>
                                </button>
                            </div>
                            <div className="drawer-log-toolbar" id="drawer-log-toolbar">
                                <input type="text" id="log-search" className="log-search" placeholder="Filter logs..." />
                                <span className="log-line-count" id="log-line-count"></span>
                                <button id="log-autoscroll-btn" className="log-autoscroll" title="Auto-scroll: OFF">
                                    <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
                                    Follow
                                </button>
                            </div>
                            <div className="log-file-info" id="log-file-info"></div>
                            <div className="drawer-logs" id="drawer-logs">No logs loaded</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* New Process Modal */}
            <div className="modal-overlay" id="new-process-modal">
                <div className="modal">
                    <div className="modal-header">
                        <h3>New Process</h3>
                        <button className="modal-close" id="modal-close-btn">✕</button>
                    </div>
                    <div className="modal-body">
                        <div className="form-group">
                            <label htmlFor="process-name-input">Process Name</label>
                            <input type="text" id="process-name-input" placeholder="my-app" />
                        </div>
                        <div className="form-group">
                            <label htmlFor="process-command-input">Command</label>
                            <input type="text" id="process-command-input" placeholder="bun run dev" />
                        </div>
                        <div className="form-group">
                            <label htmlFor="process-directory-input">Working Directory</label>
                            <input type="text" id="process-directory-input" placeholder="/path/to/project" />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button className="btn btn-ghost" id="modal-cancel-btn">Cancel</button>
                        <button className="btn btn-primary" id="modal-create-btn">Create</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
