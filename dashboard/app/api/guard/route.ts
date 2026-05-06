/**
 * POST /api/guard — Toggle per-process watcher guard
 * Body: { name: string, enabled: boolean }
 */
import { getProcess, updateProcessEnv, addHistoryEntry, parseEnvString, stringifyEnvString, syncProcessWatcher } from '../../../lib/runtime';

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
        const env = parseEnvString(proc.env || '');

        if (body.enabled) {
            env.BGR_KEEP_ALIVE = 'true';
        } else {
            delete env.BGR_KEEP_ALIVE;
        }

        updateProcessEnv(body.name, stringifyEnvString(env));
        await syncProcessWatcher(body.name, env);

        addHistoryEntry(body.name, body.enabled ? 'guard_on' : 'guard_off');

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
