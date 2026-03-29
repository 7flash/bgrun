import { guardEvents } from '../../../lib/runtime';

export async function GET() {
    return Response.json(guardEvents);
}