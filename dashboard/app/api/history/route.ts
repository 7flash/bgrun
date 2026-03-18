import { getProcessHistory, getRecentHistory, addHistoryEntry } from '../../../../src/db';

export async function GET(req: Request) {
    const url = new URL(req.url);
    const name = url.searchParams.get('name');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    
    let history;
    if (name) {
        history = getProcessHistory(name, limit);
    } else {
        history = getRecentHistory(limit);
    }
    
    return Response.json(history.map((h: any) => ({
        process_name: h.process_name,
        event: h.event,
        pid: h.pid,
        timestamp: h.timestamp,
        metadata: h.metadata ? JSON.parse(h.metadata) : {},
    })));
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { process_name, event, pid, metadata } = body;
        
        if (!process_name || !event) {
            return Response.json({ error: 'process_name and event are required' }, { status: 400 });
        }
        
        addHistoryEntry(process_name, event, pid, metadata);
        return Response.json({ success: true });
    } catch (err) {
        console.error('[api/history] Error adding history:', err);
        return Response.json({ error: 'Failed to add history' }, { status: 500 });
    }
}