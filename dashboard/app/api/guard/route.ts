/**
 * POST /api/guard — Toggle BGR_KEEP_ALIVE for a process
 * Body: { name: string, enabled: boolean }
 * 
 * When enabled=true, the built-in guard will auto-restart this process if it dies.
 * When enabled=false, the process is left alone.
 */
import { getProcess, updateProcessEnv } from '../../../src/db';

export async function POST(req: Request) {
    try {
        const body = await req.json() as { name: string; enabled: boolean };
        if (!body.name) {
            return Response.json({ error: 'Missing process name' }, { status: 400 });
        }

        const proc = getProcess(body.name);
        if (!proc) {
            return Response.json({ error: `Process "${body.name}" not found` }, { status: 404 });
        }

        // Parse existing env
        let env: Record<string, string> = {};
        if (proc.env) {
            try { env = JSON.parse(proc.env); } catch { env = {}; }
        }

        // Toggle BGR_KEEP_ALIVE
        if (body.enabled) {
            env.BGR_KEEP_ALIVE = 'true';
        } else {
            delete env.BGR_KEEP_ALIVE;
        }

        // Save back
        updateProcessEnv(body.name, JSON.stringify(env));

        return Response.json({
            ok: true,
            name: body.name,
            guarded: body.enabled
        });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function GET() {
    return Response.json({ error: 'Use POST to toggle guard' }, { status: 405 });
}
