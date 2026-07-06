import { NextResponse } from 'next/server';
import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
    const supabase = await createClient();

    try {
        const { projectId, ids } = await req.json();
        const requestedIds = normalizePricingQueueIds(Array.isArray(ids) ? ids : []);

        if (!projectId || requestedIds.length === 0) {
            return NextResponse.json(
                { success: false, error: 'projectId and ids are required' },
                { status: 400 }
            );
        }

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('contractor_id', user.id)
            .maybeSingle();

        if (projectError) {
            throw projectError;
        }

        if (!project) {
            return NextResponse.json(
                { success: false, error: 'Project not found or forbidden' },
                { status: 403 }
            );
        }

        const { data: archivedItems, error: archiveError } = await supabase
            .from('contradictions')
            .update({ status: 'ARCHIVED' })
            .eq('project_id', projectId)
            .in('id', requestedIds)
            .select('id');

        if (archiveError) {
            throw archiveError;
        }

        const archivedIds = (archivedItems || []).map((item) => item.id);
        const archivedIdSet = new Set(archivedIds);
        const skippedIds = requestedIds.filter((id) => !archivedIdSet.has(id));

        return NextResponse.json({
            success: true,
            archivedIds,
            skippedIds,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Archive pricing queue failed';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
