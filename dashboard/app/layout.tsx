/**
 * bgrun Dashboard — Root Layout (Server Component)
 * 
 * Renders the page shell: header with logo, version badge, and refresh button.
 */

export default function RootLayout({ children }: { children: any }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
                <title>bgrun Dashboard</title>
                <meta name="description" content="bgrun — Bun Background Runner — Process Manager Dashboard" />
            </head>
            <body className="antialiased">
                <div className="container">
                    <header className="header">
                        <div className="logo">
                            <div className="logo-icon">⚡</div>
                            <div>
                                <h1>bgrun</h1>
                                <span className="logo-subtitle">Bun Background Runner</span>
                            </div>
                        </div>
                        <div className="header-actions">
                            <span className="version-badge" id="version-badge">...</span>
                            <button className="btn btn-ghost" id="refresh-btn">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="23 4 23 10 17 10" />
                                    <polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                                Refresh
                            </button>
                        </div>
                    </header>

                    <main id="melina-page-content">
                        {children}
                    </main>
                </div>
            </body>
        </html>
    );
}
