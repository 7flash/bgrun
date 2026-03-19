/**
 * GET /api/check-port?port=3001 — Check if a port is in use
 * 
 * Attempts a TCP connect to localhost:port. Returns { inUse, port }.
 */

export async function GET(req: Request) {
    const url = new URL(req.url);
    const port = parseInt(url.searchParams.get('port') || '0');

    if (!port || port < 1 || port > 65535) {
        return Response.json({ error: 'Invalid port' }, { status: 400 });
    }

    const inUse = await isPortInUse(port);
    return Response.json({ port, inUse });
}

async function isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const server = Bun.serve({
                port,
                hostname: '127.0.0.1',
                fetch() { return new Response(''); },
            });
            // If we successfully bound, it's free
            server.stop(true);
            resolve(false);
        } catch {
            // Port is in use
            resolve(true);
        }
    });
}
