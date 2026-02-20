/**
 * POST /api/start — Create or start a process
 */
import { handleRun } from '../../../../src/commands/run';
import { measure } from 'measure-fn';

export async function POST(req: Request) {
    const body = await req.json();

    try {
        await measure(`Start process "${body.name}"`, () => handleRun({
            action: 'run',
            name: body.name,
            command: body.command,
            directory: body.directory,
            force: body.force || false,
            remoteName: '',
        }));
        return Response.json({ success: true });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
