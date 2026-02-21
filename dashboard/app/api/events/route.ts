/**
 * GET /api/events — Server-Sent Events endpoint
 * 
 * Streams process data every 3 seconds. Replaces client-side polling.
 * The client connects once via EventSource and receives updates automatically.
 * 
 * Delegates to /api/processes for data enrichment (including PID reconciliation).
 */

const INTERVAL_MS = 3_000;

export async function GET(req: Request) {
    const url = new URL(req.url);
    const origin = url.origin; // e.g. http://localhost:3001

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            // Send initial data immediately
            try {
                const res = await fetch(`${origin}/api/processes?t=${Date.now()}`);
                const data = await res.json();
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            } catch {
                controller.enqueue(encoder.encode(`data: []\n\n`));
            }

            controller.enqueue(encoder.encode(`: keepalive\n\n`));

            // Then send updates every INTERVAL_MS
            const interval = setInterval(async () => {
                try {
                    const res = await fetch(`${origin}/api/processes?t=${Date.now()}`);
                    const data = await res.json();
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch {
                    // Skip this tick, send on next
                }
            }, INTERVAL_MS);

            // Store cleanup for when the stream is cancelled
            (stream as any).__cleanup = () => clearInterval(interval);
        },
        cancel() {
            if ((stream as any).__cleanup) {
                (stream as any).__cleanup();
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
