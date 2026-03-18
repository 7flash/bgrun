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
                <div className="stat-card restarts">
                    <div className="stat-label">Guard Restarts</div>
                    <div className="stat-value" id="restarts-count">0</div>
                </div>
            </div>

            {/* Guard Activity Feed */}
            <div className="guard-activity" id="guard-activity">
                <div className="guard-activity-header">
                    <span className="guard-activity-title">🛡️ Guard Activity</span>
                    <span className="guard-activity-empty" id="guard-activity-empty">No recent activity</span>
                </div>
                <div className="guard-activity-list" id="guard-activity-list"></div>
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
                        <span className="search-count" id="search-count" style={{ display: 'none' }}></span>
                        <span className="search-shortcut">/</span>
                    </div>
                    <select className="group-filter" id="group-filter">
                        <option value="">All Groups</option>
                    </select>
                    <div className="deploy-preset-scopes" id="deploy-preset-scopes"></div>
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
                    <button className="btn btn-ghost" id="deploy-all-btn" title="Git pull + restart all deployable processes">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                            <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                        </svg>
                        <span id="deploy-all-label">Deploy All</span>
                    </button>
                    <div className="deploy-controls">
                        <label className="deploy-concurrency-wrap" title="Bulk deploy concurrency (saved per group)">
                            <span className="deploy-concurrency-label">Deploy</span>
                            <select className="deploy-concurrency-select" id="deploy-concurrency-select">
                                <option value="1">1×</option>
                                <option value="2">2×</option>
                                <option value="3">3×</option>
                                <option value="4">4×</option>
                            </select>
                        </label>
                        <span className="deploy-preset-source" id="deploy-preset-source" title="Current deploy preset source">default</span>
                        <button className="btn btn-ghost btn-icon" id="deploy-preset-reset-btn" title="Reset saved deploy preset for current group">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                        </button>
                    </div>
                    <span className="guard-sentinel-pill" id="guard-sentinel-pill" title="Standalone guard process status">
                        <span className="guard-sentinel-dot" id="guard-sentinel-dot" />
                        <span id="guard-sentinel-label">Guard: –</span>
                    </span>
                    <button className="btn btn-ghost btn-icon" id="shortcuts-btn" title="Keyboard Shortcuts (?)">
                        <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>?</span>
                    </button>
                    <button className="btn btn-secondary" id="templates-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                        Templates
                    </button>
                    <button className="btn btn-ghost" id="history-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        History
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

            {/* History Modal */}
            <div className="modal-overlay" id="history-modal">
                <div className="modal modal-wide">
                    <div className="modal-header">
                        <h3>📜 Process History</h3>
                        <button className="modal-close" id="history-modal-close">✕</button>
                    </div>
                    <div className="modal-body">
                        <div className="history-filters">
                            <select id="history-process-filter" className="history-select">
                                <option value="">All Processes</option>
                            </select>
                            <select id="history-event-filter" className="history-select">
                                <option value="">All Events</option>
                                <option value="start">Start</option>
                                <option value="stop">Stop</option>
                                <option value="restart">Restart</option>
                                <option value="deploy">Deploy</option>
                                <option value="guard_on">Guard On</option>
                                <option value="guard_off">Guard Off</option>
                            </select>
                            <input id="history-metadata-filter" className="history-select history-search" type="text" placeholder="Filter metadata (comma-separated)..." />
                            <label className="history-density-wrap" title="History row density">
                                <span className="history-density-label">Density</span>
                                <select id="history-density-select" className="history-select history-density-select">
                                    <option value="cozy">Cozy</option>
                                    <option value="compact">Compact</option>
                                </select>
                            </label>
                            <label className="history-shortcuts-toggle" title="Show quick-action affordances in History rows">
                                <input id="history-shortcuts-toggle" type="checkbox" />
                                <span>Shortcuts</span>
                            </label>
                            <label className="history-density-wrap" title="Default History details state">
                                <span className="history-density-label">Details</span>
                                <select id="history-details-default-select" className="history-select history-density-select">
                                    <option value="collapsed">Collapsed</option>
                                    <option value="expanded">Expanded</option>
                                </select>
                            </label>
                            <button className="btn btn-ghost btn-sm" id="history-clear-filters-btn" title="Clear all history filters">Clear</button>
                        </div>
                        <div className="history-hints-bar">
                            <div className="history-hints-bar-left">
                                <span className="history-hints-title">Keyboard shortcuts</span>
                                <div className="history-focus-controls">
                                    <button className="history-focus-jump" id="history-focus-prev" type="button" title="Focus previous History row">←</button>
                                    <span className="history-focus-status" id="history-focus-status">No row selected</span>
                                    <button className="history-focus-jump" id="history-focus-next" type="button" title="Focus next History row">→</button>
                                </div>
                                <label className="history-auto-open-toggle" title="Automatically sync the process drawer while stepping through History rows">
                                    <input id="history-auto-open-toggle" type="checkbox" />
                                    <span>Auto-open</span>
                                </label>
                                <label className="history-hint-density-wrap" title="Auto-open behavior while stepping through History rows">
                                    <span className="history-density-label">Scope</span>
                                    <select id="history-focus-scope-select" className="history-select history-hint-density-select">
                                        <option value="sync">Sync drawer</option>
                                        <option value="inspect">Inspect</option>
                                    </select>
                                </label>
                            </div>
                            <div className="history-hints-actions">
                                <label className="history-hint-density-wrap" title="Keyboard hint density">
                                    <span className="history-density-label">Hints</span>
                                    <select id="history-hint-density-select" className="history-select history-hint-density-select">
                                        <option value="full">Full</option>
                                        <option value="compact">Compact</option>
                                    </select>
                                </label>
                                <details className="history-hint-groups-menu">
                                    <summary className="history-hints-toggle" title="Choose which History hint groups to show">Groups</summary>
                                    <div className="history-hint-groups-panel">
                                        <div className="history-hint-presets">
                                            <button className="history-hint-preset" type="button" data-history-hint-preset="minimal">Minimal</button>
                                            <button className="history-hint-preset" type="button" data-history-hint-preset="navigation">Navigation</button>
                                            <button className="history-hint-preset" type="button" data-history-hint-preset="all">All</button>
                                        </div>
                                        <label className="history-hint-group-option"><input id="history-hint-group-nav" type="checkbox" /> <span>Navigation</span></label>
                                        <label className="history-hint-group-option"><input id="history-hint-group-open" type="checkbox" /> <span>Open</span></label>
                                        <label className="history-hint-group-option"><input id="history-hint-group-filter" type="checkbox" /> <span>Filters</span></label>
                                        <label className="history-hint-group-option"><input id="history-hint-group-details" type="checkbox" /> <span>Details</span></label>
                                        <label className="history-hint-group-option"><input id="history-hint-group-close" type="checkbox" /> <span>Close</span></label>
                                    </div>
                                </details>
                                <button className="history-hints-toggle" id="history-hints-toggle" type="button" title="Hide keyboard shortcut hints">Hide</button>
                            </div>
                        </div>
                        <div className="history-keyboard-hints" id="history-keyboard-hints" aria-label="History keyboard shortcuts">
                            <span className="history-keyboard-hint" data-hint-group="nav"><kbd>↑</kbd><kbd>↓</kbd><span>Move</span></span>
                            <span className="history-keyboard-hint" data-hint-group="open"><kbd>Enter</kbd><span>Open</span></span>
                            <span className="history-keyboard-hint" data-hint-group="filter"><kbd>F</kbd><span>Process filter</span></span>
                            <span className="history-keyboard-hint" data-hint-group="filter"><kbd>E</kbd><span>Event filter</span></span>
                            <span className="history-keyboard-hint" data-hint-group="details"><kbd>Space</kbd><span>Toggle details</span></span>
                            <span className="history-keyboard-hint" data-hint-group="close"><kbd>Esc</kbd><span>Close</span></span>
                        </div>
                        <div className="history-list" id="history-list">
                            <div className="history-empty">No history yet</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Templates Modal */}
            <div className="modal-overlay" id="templates-modal">
                <div className="modal modal-wide">
                    <div className="modal-header">
                        <h3>📋 Process Templates</h3>
                        <button className="modal-close" id="templates-modal-close">✕</button>
                    </div>
                    <div className="modal-body">
                        <div className="templates-form">
                            <div className="form-row">
                                <div className="form-group">
                                    <label htmlFor="template-name">Template Name</label>
                                    <input type="text" id="template-name" placeholder="my-template" />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="template-command">Command</label>
                                    <input type="text" id="template-command" placeholder="bun run dev" />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label htmlFor="template-directory">Working Directory</label>
                                    <input type="text" id="template-directory" placeholder="/path/to/project" />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="template-group">Group</label>
                                    <input type="text" id="template-group" placeholder="my-group" />
                                </div>
                            </div>
                            <div className="form-group">
                                <label htmlFor="template-env">Environment (KEY=VAL,KEY2=VAL2)</label>
                                <input type="text" id="template-env" placeholder="BGR_KEEP_ALIVE=true,PORT=3000" />
                            </div>
                            <div className="templates-actions">
                                <button className="btn btn-primary" id="template-save-btn">Save Template</button>
                            </div>
                        </div>
                        <div className="templates-list" id="templates-list">
                            <div className="templates-empty">No templates saved yet</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Deploy Results Modal */}
            <div className="modal-overlay" id="deploy-results-modal">
                <div className="modal modal-wide">
                    <div className="modal-header">
                        <h3>🚀 Deploy Results</h3>
                        <button className="modal-close" id="deploy-results-modal-close">✕</button>
                    </div>
                    <div className="modal-body">
                        <div className="deploy-results-summary" id="deploy-results-summary">
                            No deploy results yet
                        </div>
                        <div className="deploy-results-list" id="deploy-results-list">
                            <div className="history-empty">Run a bulk deploy to see detailed results</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Keyboard Shortcuts Overlay */}
            <div className="shortcuts-overlay" id="shortcuts-overlay">
                <div className="shortcuts-panel">
                    <div className="shortcuts-header">
                        <h3>⌨️ Keyboard Shortcuts</h3>
                        <button className="shortcuts-close" id="shortcuts-close-btn">✕</button>
                    </div>
                    <div className="shortcuts-grid">
                        <div className="shortcut-section">
                            <h4>Navigation</h4>
                            <div className="shortcut-row"><kbd>↑</kbd><kbd>↓</kbd><span>Navigate processes</span></div>
                            <div className="shortcut-row"><kbd>Enter</kbd><span>Open process drawer</span></div>
                            <div className="shortcut-row"><kbd>/</kbd><span>Focus search</span></div>
                            <div className="shortcut-row"><kbd>Esc</kbd><span>Close panel / blur</span></div>
                        </div>
                        <div className="shortcut-section">
                            <h4>Actions</h4>
                            <div className="shortcut-row"><kbd>R</kbd><span>Restart process</span></div>
                            <div className="shortcut-row"><kbd>S</kbd><span>Stop process</span></div>
                            <div className="shortcut-row"><kbd>G</kbd><span>Toggle guard</span></div>
                            <div className="shortcut-row"><kbd>D</kbd><span>Delete process</span></div>
                            <div className="shortcut-row"><kbd>N</kbd><span>New process</span></div>
                            <div className="shortcut-row"><kbd>?</kbd><span>This help</span></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
