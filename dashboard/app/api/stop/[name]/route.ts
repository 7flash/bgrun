/**
 * POST /api/stop/:name — Stop a running process
 */
import { getProcess } from '../../../../../src/db';
import { isProcessRunning, terminateProcess } from '../../../../../src/platform';
import { measure } from 'measure-fn';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);

    return await measure(`Stop process "${name}"`, async (m) => {
        const proc = getProcess(name);
        const running = proc ? await m('Check running', () => isProcessRunning(proc.pid)) : false;

        if (!proc || !running) {
            return Response.json({ error: 'Process not found or not running' }, { status: 404 });
        }

        await m('Terminate', () => terminateProcess(proc.pid));
        return Response.json({ success: true });
    });
}
