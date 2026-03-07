/**
 * GET  /api/deps — Get the process dependency graph
 * POST /api/deps — Set dependencies for a process
 *   Body: { name: string, dependsOn: string[] }
 */

import { getProcess, updateProcessEnv } from '../../../../src/db'
import { buildDepGraph } from '../../../../src/deps'
import { parseEnvString } from '../../../../src/utils'

export async function GET() {
    const graph = await buildDepGraph()
    return Response.json(graph)
}

export async function POST(req: Request) {
    try {
        const body = await req.json() as { name: string; dependsOn: string[] }
        if (!body.name) {
            return Response.json({ error: 'Missing process name' }, { status: 400 })
        }

        const proc = getProcess(body.name)
        if (!proc) {
            return Response.json({ error: `Process "${body.name}" not found` }, { status: 404 })
        }

        // Parse existing env
        let env: Record<string, string> = {}
        try { env = JSON.parse(proc.env) } catch { env = parseEnvString(proc.env) }

        // Update dependencies
        if (body.dependsOn && body.dependsOn.length > 0) {
            env.BGR_DEPENDS_ON = body.dependsOn.join(',')
        } else {
            delete env.BGR_DEPENDS_ON
        }

        updateProcessEnv(body.name, JSON.stringify(env))

        return Response.json({
            ok: true,
            name: body.name,
            dependsOn: body.dependsOn || [],
        })
    } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 })
    }
}
