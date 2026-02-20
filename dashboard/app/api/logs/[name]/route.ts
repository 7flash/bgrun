/**
 * GET /api/logs/:name — Read last 100 lines of process stdout/stderr
 */
import { getProcess } from '../../../../../src/db';
import { readFileTail } from '../../../../../src/platform';
import { measure } from 'measure-fn';

export async function GET(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const result = await measure(`Read logs "${name}"`, async (m) => ({
        stdout: await m('stdout', () => readFileTail(proc.stdout_path, 100)) ?? '',
        stderr: await m('stderr', () => readFileTail(proc.stderr_path, 100)) ?? '',
    }));

    return Response.json(result);
}
