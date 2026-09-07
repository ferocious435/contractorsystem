import { NextResponse } from 'next/server';
import { archiveContradictionRows, type ContradictionArchiveRow } from '@/utils/contradiction-archive';
import { buildContradictionReviewUpdate, type ContradictionReviewInput } from '@/utils/contradiction-review';
import { createClient } from '@/utils/supabase/server';

const ALLOWED_CONTRADICTION_STATUSES = new Set([
    'OPEN',
    'RESOLVED',
    'MOVED_TO_PRICING',
    'ARCHIVED',
]);

async function requireOwnedProject(supabase: Awaited<ReturnType<typeof createClient>>, projectId: string) {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return {
            ok: false as const,
            response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
        };
    }

    const { data: project, error } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('contractor_id', user.id)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!project) {
        return {
            ok: false as const,
            response: NextResponse.json({ success: false, error: 'Project not found or forbidden' }, { status: 403 }),
        };
    }

    return { ok: true as const };
}

export async function PATCH(req: Request) {
    const supabase = await createClient();

    try {
        const { projectId, id, status, review } = await req.json() as {
            projectId?: string;
            id?: string;
            status?: string;
            review?: ContradictionReviewInput;
        };

        if (!projectId || !id || (!status && !review)) {
            return NextResponse.json(
                { success: false, error: 'projectId, id and a status or review are required' },
                { status: 400 }
            );
        }

        if (status && !ALLOWED_CONTRADICTION_STATUSES.has(status)) {
            return NextResponse.json({ success: false, error: 'Unsupported contradiction status' }, { status: 400 });
        }

        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        const updatePayload: Record<string, unknown> = {};
        if (status) updatePayload.status = status;

        if (review) {
            const { data: existingItem, error: existingItemError } = await supabase
                .from('contradictions')
                .select('id, evidence_data')
                .eq('id', id)
                .eq('project_id', projectId)
                .maybeSingle();

            if (existingItemError) throw existingItemError;
            if (!existingItem) {
                return NextResponse.json({ success: false, error: 'Contradiction not found' }, { status: 404 });
            }

            Object.assign(updatePayload, buildContradictionReviewUpdate(existingItem.evidence_data, review));
        }

        const { data: updatedItems, error } = await supabase
            .from('contradictions')
            .update(updatePayload)
            .eq('id', id)
            .eq('project_id', projectId)
            .select('id, status, title, description, category, severity, strategy_advice, evidence_data');

        if (error) {
            throw error;
        }

        if (!updatedItems?.length) {
            return NextResponse.json({ success: false, error: 'Contradiction not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, item: updatedItems[0] });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Contradiction status update failed';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    const supabase = await createClient();

    try {
        const { projectId, id } = await req.json();

        if (!projectId || !id) {
            return NextResponse.json(
                { success: false, error: 'projectId and id are required' },
                { status: 400 }
            );
        }

        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        const { data: rowsToArchive, error } = await supabase
            .from('contradictions')
            .select('id, evidence_data')
            .eq('id', id)
            .eq('project_id', projectId)
            .neq('status', 'ARCHIVED');

        if (error) {
            throw error;
        }

        if (!rowsToArchive?.length) {
            return NextResponse.json({ success: false, error: 'Contradiction not found' }, { status: 404 });
        }

        const archived = await archiveContradictionRows(
            supabase,
            rowsToArchive as ContradictionArchiveRow[],
            {
                archive_reason: 'Finding was removed from the active view. Historical record is retained.',
                archived_at: new Date().toISOString(),
            }
        );

        return NextResponse.json({
            success: true,
            archived,
            archivedId: rowsToArchive[0].id,
            deletedId: rowsToArchive[0].id,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Contradiction delete failed';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
