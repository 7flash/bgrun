import { deployAllProcesses } from '../../../lib/runtime';

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const group = body?.group ? String(body.group) : undefined;
        const results = await deployAllProcesses(group);

        const deployed = results.filter(r => r.ok);
        const skipped = results.filter(r => r.skipped);
        const failed = results.filter(r => !r.ok && !r.skipped);

        return Response.json({
            success: failed.length === 0,
            group: group || null,
            total: results.length,
            deployed: deployed.length,
            skipped: skipped.length,
            failed: failed.length,
            results,
        }, { status: failed.length > 0 ? 207 : 200 });
    } catch (e: any) {
        return Response.json({ error: e?.message || String(e) }, { status: 500 });
    }
}
