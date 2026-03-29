import { getProcessHistory, getRecentHistory, addHistoryEntry } from '../../../../src/db';

function stringifyMetadata(metadata: unknown) {
    try {
        return JSON.stringify(metadata ?? {});
    } catch {
        return '{}';
    }
}

function escapeCsv(value: unknown) {
    const text = String(value ?? '');
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

function buildHistoryCsv(rows: Array<{
    process_name: string;
    event: string;
    pid: number | null;
    timestamp: string;
    metadata: unknown;
}>) {
    const header = ['process_name', 'event', 'pid', 'timestamp', 'metadata'];
    const lines = rows.map((row) => [
        row.process_name,
        row.event,
        row.pid ?? '',
        row.timestamp,
        stringifyMetadata(row.metadata),
    ].map(escapeCsv).join(','));
    return [header.join(','), ...lines].join('\n');
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const name = url.searchParams.get('name');
    const event = (url.searchParams.get('event') || '').trim().toLowerCase();
    const metadataFilter = (url.searchParams.get('metadata') || '')
        .split(',')
        .map((value) => value.toLowerCase().trim())
        .filter(Boolean);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const download = url.searchParams.get('download') === '1';

    let history;
    if (name) {
        history = getProcessHistory(name, limit);
    } else {
        history = getRecentHistory(limit);
    }

    let rows = history.map((h: any) => ({
        process_name: h.process_name,
        event: h.event,
        pid: h.pid,
        timestamp: h.timestamp,
        metadata: h.metadata ? JSON.parse(h.metadata) : {},
    }));

    if (event) {
        rows = rows.filter((row) => row.event.toLowerCase() === event);
    }
    if (metadataFilter.length > 0) {
        rows = rows.filter((row) => {
            const haystack = stringifyMetadata(row.metadata).toLowerCase();
            return metadataFilter.every((term) => haystack.includes(term));
        });
    }

    if (format === 'csv') {
        return new Response(buildHistoryCsv(rows), {
            headers: {
                'content-type': 'text/csv; charset=utf-8',
                ...(download ? { 'content-disposition': `attachment; filename="bgr-history${name ? `-${encodeURIComponent(name)}` : ''}.csv"` } : {}),
            },
        });
    }

    return Response.json(rows, {
        headers: download
            ? { 'content-disposition': `attachment; filename="bgr-history${name ? `-${encodeURIComponent(name)}` : ''}.json"` }
            : undefined,
    });
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
