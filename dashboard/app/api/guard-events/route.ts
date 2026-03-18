import { guardEvents } from '../../../../src/server';

export async function GET() {
    return Response.json(guardEvents);
}