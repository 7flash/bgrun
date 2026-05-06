/**
 * POST /api/guard-all — Bulk toggle per-process watcher guard
 * Body: { enabled: boolean }
 */
import { getAllProcesses, updateProcessEnv, parseEnvString, stringifyEnvString, syncProcessWatcher, isInternalProcessName } from '../../../lib/runtime';

export async function POST(req: Request) {
    try {
        const body = await req.json() as { enabled: boolean };
        const processes = getAllProcesses();
        let count = 0;

        for (const proc of processes) {
            if (isInternalProcessName(proc.name)) continue;

            const env = parseEnvString(proc.env || '');

            const alreadyGuarded = env.BGR_KEEP_ALIVE === 'true';
            if (body.enabled && alreadyGuarded) continue;
            if (!body.enabled && !alreadyGuarded) continue;

            if (body.enabled) {
                env.BGR_KEEP_ALIVE = 'true';
            } else {
                delete env.BGR_KEEP_ALIVE;
            }

            updateProcessEnv(proc.name, stringifyEnvString(env));
            await syncProcessWatcher(proc.name, env);
            count++;
        }

        return Response.json({
            ok: true,
            action: body.enabled ? 'guarded' : 'unguarded',
            count,
            total: processes.length,
        });
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
    }
}
