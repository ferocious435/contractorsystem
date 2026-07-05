import {
    AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
    getPricingEvidenceConfidenceScore,
    type PricingConfidenceEvidenceCarrier,
} from '@/utils/pricing-confidence';
import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BulkConfidencePreviewInput {
    projectId: string;
    requestedIds: string[];
}

export interface BulkConfidencePreviewResult {
    success: true;
    stagedIds: string[];
    approvedIds: string[];
    skippedIds: string[];
    threshold: number;
}

interface BulkConfidenceContradictionRow extends PricingConfidenceEvidenceCarrier {
    id: string;
}

export class BulkConfidencePreviewService {
    constructor(private readonly supabase: SupabaseClient) {}

    async previewHighConfidenceItems({
        projectId,
        requestedIds,
    }: BulkConfidencePreviewInput): Promise<BulkConfidencePreviewResult> {
        const uniqueRequestedIds = normalizePricingQueueIds(requestedIds);

        if (uniqueRequestedIds.length === 0) {
            return {
                success: true,
                stagedIds: [],
                approvedIds: [],
                skippedIds: [],
                threshold: AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
            };
        }

        const { data: contradictions, error } = await this.supabase
            .from('contradictions')
            .select('id, evidence_data')
            .eq('project_id', projectId)
            .in('id', uniqueRequestedIds);

        if (error) {
            throw error;
        }

        const rows = (contradictions || []) as BulkConfidenceContradictionRow[];
        const foundIds = new Set(rows.map((item) => item.id));
        const stagedIds = rows
            .filter((item) => {
                const score = getPricingEvidenceConfidenceScore(item);
                return score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD;
            })
            .map((item) => item.id);
        const stagedIdSet = new Set(stagedIds);
        const skippedIds = uniqueRequestedIds.filter((id) => !foundIds.has(id) || !stagedIdSet.has(id));

        return {
            success: true,
            stagedIds,
            approvedIds: stagedIds,
            skippedIds,
            threshold: AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
        };
    }
}
