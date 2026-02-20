/**
 * GET /api/debug — Debug info about BGR internals
 * 
 * Returns DB path, BGR home dir, platform info for diagnostics.
 */
import { getDbInfo } from '../../../../src/db';
import { measureSync } from 'measure-fn';

export async function GET() {
    const info = measureSync('DB info', () => getDbInfo());
    return Response.json({
        ...info,
        platform: process.platform,
        bun: Bun.version,
        pid: process.pid,
        cwd: process.cwd(),
    });
}
