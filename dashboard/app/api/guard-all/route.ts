/**
 * POST /api/guard-all — Bulk toggle guard for all processes
 * Body: { enabled: boolean }
 * 
 * When enabled=true, sets BGR_KEEP_ALIVE=true for ALL processes (except bgr-dashboard).
 * When enabled=false, removes BGR_KEEP_ALIVE from ALL processes.
 */
import { getAllProcesses, getProcess, updateProcessEnv } from '../../../../src/db';

const SKIP = new Set(['bgr-dashboard']);

export async function POST(req: Request) {
    try {
        const body = await req.json() as { enabled: boolean };
        const processes = getAllProcesses();
        let count = 0;

        for (const proc of processes) {
            if (SKIP.has(proc.name)) continue;

            // Parse existing env
            let env: Record<string, string> = {};
            if (proc.env) {
                try { env = JSON.parse(proc.env); } catch { env = {}; }
            }

            const alreadyGuarded = env.BGR_KEEP_ALIVE === 'true';
            if (body.enabled && alreadyGuarded) continue;
            if (!body.enabled && !alreadyGuarded) continue;

            if (body.enabled) {
                env.BGR_KEEP_ALIVE = 'true';
            } else {
                delete env.BGR_KEEP_ALIVE;
            }

            updateProcessEnv(proc.name, JSON.stringify(env));
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
