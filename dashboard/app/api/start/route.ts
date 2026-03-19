/**
 * POST /api/start — Create or start a process
 */
import { handleRun } from '../../../../src/commands/run';
import { addHistoryEntry } from '../../../../src/db';
import { measure } from 'measure-fn';

export async function POST(req: Request) {
    const body = await req.json();

    try {
        // Build env from body.env object if provided (e.g. { PORT: "3001" })
        const env = body.env && typeof body.env === 'object'
            ? body.env as Record<string, string>
            : undefined;

        await measure(`Start process "${body.name}"`, () => handleRun({
            action: 'run',
            name: body.name,
            command: body.command,
            directory: body.directory,
            force: body.force || false,
            env,
            remoteName: '',
        }));
        
        // Record history
        addHistoryEntry(body.name, 'start');
        
        return Response.json({ success: true });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
