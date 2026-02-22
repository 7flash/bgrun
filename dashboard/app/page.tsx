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
                <div className="stat-card memory">
                    <div className="stat-label">Total Memory</div>
                    <div className="stat-value" id="memory-count">–</div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="toolbar">
                <div className="toolbar-left">
                    <h2>Processes</h2>
                    <div className="search-wrapper">
                        <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input type="text" className="search-input" id="search-input" placeholder="Filter processes..." />
                        <span className="search-shortcut">/</span>
                    </div>
                    <button className="btn btn-ghost btn-icon" id="group-toggle-btn" title="Toggle Grouping">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 21v-7" />
                            <path d="M4 10V3" />
                            <path d="M12 21v-9" />
                            <path d="M12 8V3" />
                            <path d="M20 21v-5" />
                            <path d="M20 12V3" />
                            <path d="M1 14h6" />
                            <path d="M9 8h6" />
                            <path d="M17 16h6" />
                        </svg>
                    </button>
                </div>
                <button className="btn btn-primary" id="new-process-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New Process
                </button>
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
                            <th style={{ width: '70px' }}>Memory</th>
                            <th>Command</th>
                            <th style={{ width: '80px' }}>Runtime</th>
                            <th style={{ width: '150px' }}>Actions</th>
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
                <div className="drawer-header">
                    <h3>
                        <span id="drawer-process-name">Process</span>
                    </h3>
                    <button className="drawer-close" id="drawer-close-btn">✕</button>
                </div>
                <div className="drawer-meta" id="drawer-meta"></div>
                <div className="drawer-tabs">
                    <button className="drawer-tab active" data-tab="stdout">Stdout</button>
                    <button className="drawer-tab" data-tab="stderr">Stderr</button>
                </div>
                <div className="drawer-content">
                    <div className="drawer-log-toolbar">
                        <input type="text" id="log-search" className="log-search" placeholder="Filter logs..." />
                        <button id="log-autoscroll-btn" className="log-autoscroll active" title="Auto-scroll">↓</button>
                    </div>
                    <div className="log-file-info" id="log-file-info"></div>
                    <div className="drawer-logs" id="drawer-logs">No logs loaded</div>
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
