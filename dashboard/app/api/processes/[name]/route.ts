/**
 * DELETE /api/processes/:name — Stop and remove a process
 */
import { getProcess, removeProcessByName } from '../../../../../src/db';
import { isProcessRunning, terminateProcess } from '../../../../../src/platform';
import { measure } from 'measure-fn';

export async function DELETE(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Not found' }, { status: 404 });
    }

    if (await isProcessRunning(proc.pid)) {
        await measure(`Terminate "${name}" before delete`, () => terminateProcess(proc.pid));
    }

    removeProcessByName(name);
    return Response.json({ success: true });
}
