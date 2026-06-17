import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const CONFIDENCE_THRESHOLD = 0.9;

function normalizeConfidenceScore(value: unknown): number | null {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    if (parsed <= 1) {
        return parsed;
    }

    if (parsed <= 100) {
        return parsed / 100;
    }

    return 1;
}

function getContradictionConfidenceScore(item: Record<string, any>): number | null {
    const evidenceData = item.evidence_data;
    const evidenceObject = !Array.isArray(evidenceData) && evidenceData ? evidenceData : null;
    const pricingEvaluation = evidenceObject?.pricing_evaluation;

    return normalizeConfidenceScore(
        pricingEvaluation?.confidence_score
        ?? pricingEvaluation?.confidence
        ?? evidenceObject?.confidence_score
        ?? evidenceObject?.confidence
    );
}

export async function POST(req: Request) {
    const supabase = await createClient();

    try {
        const { projectId, ids } = await req.json();
        const requestedIds = Array.isArray(ids)
            ? ids.map((id) => String(id || '').trim()).filter(Boolean)
            : [];

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

        const { data: contradictions, error } = await supabase
            .from('contradictions')
            .select('id, evidence_data')
            .eq('project_id', projectId)
            .in('id', requestedIds);

        if (error) {
            throw error;
        }

        const foundIds = new Set((contradictions || []).map((item) => item.id));
        const approvedIds = (contradictions || [])
            .filter((item) => {
                const score = getContradictionConfidenceScore(item);
                return score !== null && score > CONFIDENCE_THRESHOLD;
            })
            .map((item) => item.id);
        const approvedIdSet = new Set(approvedIds);
        const skippedIds = requestedIds.filter((id) => !foundIds.has(id) || !approvedIdSet.has(id));

        return NextResponse.json({
            success: true,
            approvedIds,
            skippedIds,
            threshold: CONFIDENCE_THRESHOLD,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Bulk confidence preview failed';
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
