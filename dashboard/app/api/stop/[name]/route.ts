/**
 * POST /api/stop/:name — Stop a running process
 */
import { getProcess } from '../../../../../src/db';
import { isProcessRunning, terminateProcess } from '../../../../../src/platform';
import { measure } from 'measure-fn';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const running = await isProcessRunning(proc.pid);
    if (!running) {
        return Response.json({ error: 'Process not running' }, { status: 404 });
    }

    await measure(`Stop "${name}" (PID ${proc.pid})`, () => terminateProcess(proc.pid));
    return Response.json({ success: true });
}
