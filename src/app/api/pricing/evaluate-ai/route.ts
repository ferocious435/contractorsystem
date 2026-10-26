import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requirePricingEvaluationProjectAccess } from './evaluation-access';
import { reviewWorkChangeCase, WorkChangeReviewHttpError } from '@/utils/work-change-review-server';
import {
    AiEstimatorService,
    PricingEvaluationHttpError,
} from './ai-estimator-service';

export async function POST(req: Request) {
    const supabase = await createClient();

    try {
        const { contradictionId, projectId, expertMode = false, reviewCaseOnly = false } = await req.json();

        if (!contradictionId || !projectId) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const access = await requirePricingEvaluationProjectAccess(supabase, projectId);
        if (!access.ok) return access.response;

        if (reviewCaseOnly === true) {
            if (typeof contradictionId !== 'string' || typeof projectId !== 'string') {
                return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
            }
            const result = await reviewWorkChangeCase({ supabase, projectId, findingId: contradictionId,
                refreshReading: true, signal: req.signal });
            return NextResponse.json({ success: true, ...result });
        }

        const aiEstimator = new AiEstimatorService(supabase);
        const result = await aiEstimator.evaluate({
            contradictionId,
            projectId,
            expertMode,
            contractorId: access.user.id,
        });

        return NextResponse.json(result);
    } catch (error: unknown) {
        if (error instanceof PricingEvaluationHttpError || error instanceof WorkChangeReviewHttpError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        const details = error instanceof Error ? error.message : String(error);
        console.error('Pricing AI Error:', error);
        return NextResponse.json({
            error: 'Failed to evaluate pricing',
            details,
        }, { status: 500 });
    }
}
