import { getDependencyGraph, addDependency, removeDependency, getStartOrder, getAllProcesses } from "../../../../src/db";

/** GET /api/dependencies — full dependency graph + start order */
export function GET() {
    const graph = getDependencyGraph();
    const startOrder = getStartOrder();
    const processes = getAllProcesses().map(p => ({
        name: p.name,
        group: p.group || '',
        pid: p.pid,
    }));

    return Response.json({ graph, startOrder, processes });
}

/** POST /api/dependencies — add a dependency */
export async function POST(req: Request) {
    const body = await req.json() as { process: string; depends_on: string };
    if (!body.process || !body.depends_on) {
        return Response.json({ error: 'Missing process or depends_on' }, { status: 400 });
    }

    const ok = addDependency(body.process, body.depends_on);
    if (!ok) {
        return Response.json({ error: 'Invalid dependency (duplicate, self-reference, or would create cycle)' }, { status: 400 });
    }

    return Response.json({ ok: true });
}

/** DELETE /api/dependencies — remove a dependency */
export async function DELETE(req: Request) {
    const body = await req.json() as { process: string; depends_on: string };
    if (!body.process || !body.depends_on) {
        return Response.json({ error: 'Missing process or depends_on' }, { status: 400 });
    }

    removeDependency(body.process, body.depends_on);
    return Response.json({ ok: true });
}
