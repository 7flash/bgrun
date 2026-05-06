import { getRecentGuardEvents } from '../../../lib/runtime';

export async function GET() {
    return Response.json(getRecentGuardEvents());
}
