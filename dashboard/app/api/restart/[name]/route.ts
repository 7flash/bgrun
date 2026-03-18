/**
 * POST /api/restart/:name — Force-restart a process
 */
import { handleRun } from '../../../../../src/commands/run';
import { addHistoryEntry, getProcess } from '../../../../../src/db';
import { measure } from 'measure-fn';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);
    const oldPid = proc?.pid;

    try {
        await measure(`Restart "${name}"`, () => handleRun({
            action: 'run',
            name,
            force: true,
            remoteName: '',
        }));
        
        // Record history
        addHistoryEntry(name, 'restart', oldPid);
        
        return Response.json({ success: true });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
