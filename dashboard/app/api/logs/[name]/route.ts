/**
 * GET /api/logs/:name — Read last 100 lines of process stdout/stderr
 */
import { getProcess } from '../../../../../src/db';
import { readFileTail } from '../../../../../src/platform';

export async function GET(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const [stdout, stderr] = await Promise.all([
        readFileTail(proc.stdout_path, 100).catch(() => ''),
        readFileTail(proc.stderr_path, 100).catch(() => ''),
    ]);

    return Response.json({ stdout, stderr });
}
