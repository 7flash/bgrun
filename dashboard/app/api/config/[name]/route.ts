/**
 * GET  /api/config/:name — Read .config.toml content
 * PUT  /api/config/:name — Write .config.toml content
 */
import { getProcess } from '../../../../lib/runtime';
import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';

function resolveConfigPath(proc: any): string | null {
    if (!proc.configPath) return null;
    return join(proc.workdir, proc.configPath);
}

export async function GET(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const configPath = resolveConfigPath(proc);
    if (!configPath) {
        return Response.json({ content: '', path: null, exists: false });
    }

    try {
        const content = await readFile(configPath, 'utf-8');
        return Response.json({ content, path: configPath, exists: true });
    } catch {
        return Response.json({ content: '', path: configPath, exists: false });
    }
}

export async function PUT(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);
    const proc = getProcess(name);

    if (!proc) {
        return Response.json({ error: 'Process not found' }, { status: 404 });
    }

    const configPath = resolveConfigPath(proc);
    if (!configPath) {
        return Response.json({ error: 'No config path configured' }, { status: 400 });
    }

    try {
        const body = await req.json();
        await writeFile(configPath, body.content, 'utf-8');
        return Response.json({ success: true, path: configPath });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
