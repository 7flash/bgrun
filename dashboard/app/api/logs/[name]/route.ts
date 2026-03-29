/**
 * GET /api/logs/:name — Read process stdout/stderr logs
 *
 * Supports incremental loading via query params:
 *   ?tab=stdout|stderr   — which log to read (default: stdout)
 *   ?offset=N            — byte offset to start reading from (default: 0 = full file)
 *   ?format=json|text|csv — response format (default: json)
 *
 * Returns JSON by default:
 *   { text, size, mtime, filePath }
 */
import { getProcess } from '../../../../../src/db';
import { stat, open } from 'fs/promises';

interface FileInfo {
    text: string;
    size: number;
    mtime: string | null;
    filePath: string;
}

function escapeCsv(value: unknown) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function buildLogCsv(text: string) {
    const header = 'line,text';
    const lines = text.split('\n').map((line, index) => `${index + 1},${escapeCsv(line)}`);
    return [header, ...lines].join('\n');
}

async function readLogFile(path: string, offset: number): Promise<FileInfo> {
    try {
        const s = await stat(path);
        const size = s.size;
        const mtime = s.mtime.toISOString();

        if (offset >= size) {
            return { text: '', size, mtime, filePath: path };
        }

        const handle = await open(path, 'r');
        try {
            const bytesToRead = size - offset;
            const buffer = Buffer.alloc(bytesToRead);
            await handle.read(buffer, 0, bytesToRead, offset);
            return { text: buffer.toString('utf-8'), size, mtime, filePath: path };
        } finally {
            await handle.close();
        }
    } catch {
        return { text: '', size: 0, mtime: null, filePath: path };
    }
}

export async function GET(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const url = new URL(req.url);
    const tab = url.searchParams.get('tab') || 'stdout';
    const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const download = url.searchParams.get('download') === '1';

    const path = tab === 'stderr' ? proc.stderr_path : proc.stdout_path;
    const info = await readLogFile(path, offset);

    if (format === 'text') {
        return new Response(info.text, {
            headers: {
                'content-type': 'text/plain; charset=utf-8',
                ...(download ? { 'content-disposition': `attachment; filename="${encodeURIComponent(name)}-${tab}.log"` } : {}),
            },
        });
    }

    if (format === 'csv') {
        return new Response(buildLogCsv(info.text), {
            headers: {
                'content-type': 'text/csv; charset=utf-8',
                ...(download ? { 'content-disposition': `attachment; filename="${encodeURIComponent(name)}-${tab}.csv"` } : {}),
            },
        });
    }

    return Response.json(info, {
        headers: download
            ? { 'content-disposition': `attachment; filename="${encodeURIComponent(name)}-${tab}.json"` }
            : undefined,
    });
}
