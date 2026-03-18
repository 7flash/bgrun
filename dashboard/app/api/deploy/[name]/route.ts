/**
 * POST /api/deploy/:name — Git pull + install deps + restart a process
 * 
 * Only works if the process directory is a git repository.
 * Steps: git pull → bun install → force restart
 */
import { deployProcess } from '../../../../../src/deploy';

export async function POST(req: Request, { params }: { params: { name: string } }) {
    const name = decodeURIComponent(params.name);

    try {
        const result = await deployProcess(name);
        if (result.ok) {
            return Response.json({ success: true, ...result });
        }

        const status = result.skipped ? 400 : 500;
        return Response.json({ error: result.reason || `Failed to deploy '${name}'`, ...result }, { status });
    } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
    }
}
