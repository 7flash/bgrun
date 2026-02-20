/**
 * GET /api/version — Return BGR version
 */
import { getVersion } from '../../../../src/utils';
import { measure } from 'measure-fn';

export async function GET() {
    const version = await measure('Get version', () => getVersion());
    return Response.json({ version });
}
