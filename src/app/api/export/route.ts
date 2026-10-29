import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { buildLedgerCsv } from '@/utils/letter-export';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const format = searchParams.get('format');

    if (!projectId) {
        return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    if (format !== 'csv') {
        return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

    try {
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: ownedProject, error: ownershipError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('contractor_id', user.id)
            .maybeSingle();

        if (ownershipError) {
            console.error('Export project error:', ownershipError);
            return NextResponse.json({ error: 'Failed to fetch project data' }, { status: 500 });
        }

        if (!ownedProject) {
            return NextResponse.json({ error: 'Project not found or forbidden' }, { status: 403 });
        }

        const [{ data, error }, { data: project, error: projectError }] = await Promise.all([
            supabase
                .from('pricing_ledger')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true }),
            supabase
                .from('projects')
                .select('budget')
                .eq('id', projectId)
                .eq('contractor_id', user.id)
                .maybeSingle(),
        ]);

        if (error) {
            console.error('Export error:', error);
            return NextResponse.json({ error: 'Failed to fetch ledger data' }, { status: 500 });
        }

        if (projectError || !project) {
            console.error('Export project error:', projectError);
            return NextResponse.json({ error: 'Failed to fetch project data' }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return new NextResponse('No data found for project', { status: 404 });
        }

        const csvContent = buildLedgerCsv(data, project.budget);

        const bom = '\uFEFF';

        return new NextResponse(bom + csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="ledger_${projectId}.csv"`,
            },
        });
    } catch (err: unknown) {
        console.error('Export API error:', err);
        const message = err instanceof Error ? err.message : 'Export failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
