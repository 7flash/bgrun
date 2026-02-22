/**
 * GET /api/logs/:name — Read last 100 lines of process stdout/stderr
 * Returns log content + file modification timestamps
 */
import { getProcess } from '../../../../../src/db';
import { readFileTail } from '../../../../../src/platform';
import { stat } from 'fs/promises';

async function getFileMtime(path: string): Promise<string | null> {
    try {
        const s = await stat(path);
        return s.mtime.toISOString();
    } catch {
        return null;
    }
}

export async function GET(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const [stdout, stderr, stdoutModified, stderrModified] = await Promise.all([
        readFileTail(proc.stdout_path, 100).catch(() => ''),
        readFileTail(proc.stderr_path, 100).catch(() => ''),
        getFileMtime(proc.stdout_path),
        getFileMtime(proc.stderr_path),
    ]);

    return Response.json({ stdout, stderr, stdoutModified, stderrModified });
}
