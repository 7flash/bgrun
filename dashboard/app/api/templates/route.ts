import { getAllTemplates, saveTemplate, deleteTemplate } from '../../../lib/runtime';

export async function GET() {
    const templates = getAllTemplates();
    return Response.json(templates.map((t: any) => ({
        name: t.name,
        command: t.command,
        workdir: t.workdir,
        env: t.env,
        group: t.group,
        created_at: t.created_at,
    })));
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, command, workdir, env, group } = body;
        
        if (!name || !command) {
            return Response.json({ error: 'name and command are required' }, { status: 400 });
        }
        
        saveTemplate({ name, command, workdir, env, group });
        return Response.json({ success: true, name });
    } catch (err) {
        console.error('[api/templates] Error saving template:', err);
        return Response.json({ error: 'Failed to save template' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const url = new URL(req.url);
        const name = url.searchParams.get('name');
        
        if (!name) {
            return Response.json({ error: 'name is required' }, { status: 400 });
        }
        
        deleteTemplate(name);
        return Response.json({ success: true });
    } catch (err) {
        console.error('[api/templates] Error deleting template:', err);
        return Response.json({ error: 'Failed to delete template' }, { status: 500 });
    }
}