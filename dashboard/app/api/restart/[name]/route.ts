/**
 * POST /api/restart/:name — Force-restart a process
 */
import { handleRun } from '../../../../../src/commands/run';
import { measure } from 'measure-fn';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);

    try {
        await measure(`Restart process "${name}"`, () => handleRun({
            action: 'run',
            name,
            force: true,
            remoteName: '',
        }));
        return Response.json({ success: true });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
