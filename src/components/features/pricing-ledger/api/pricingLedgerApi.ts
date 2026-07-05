import { createClient } from '@/utils/supabase/client';
import {
    AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
    getPricingEvidenceConfidenceScore,
} from '@/utils/pricing-confidence';
import { normalizePricingQueueIds } from '@/utils/pricing-queue-ids';
import type {
    ArchivePricingQueueResult,
    BulkApprovePreviewResult,
    FetchLedgerRowsResult,
    PricingAiContradictionMetadata,
    PricingContradictionItem,
    PricingLedgerApiResult,
    PricingLedgerItem,
    PricingLedgerStatusUpdate,
    ProjectContractBaseSyncResult,
    SavePricingLedgerPayload,
    SyncBoqAndContractResult,
} from '../types';

const PRICING_LEDGER_SELECT_COLUMNS = [
    'id',
    'project_id',
    'type',
    'source',
    'item_code',
    'description',
    'unit',
    'quantity',
    'unit_price_excl_vat',
    'total_price_excl_vat',
    'markup_percentage',
    'ai_rationale',
    'governing_notes',
    'expert_strategy',
    'evidence_data',
    'contradiction_id',
    'vat_rate',
    'created_at',
].join(', ');

const PENDING_QUEUE_SELECT_COLUMNS = `
    id,
    project_id,
    title,
    description,
    category,
    severity,
    status,
    pricing_status,
    source_execution_doc_id,
    target_contract_doc_id,
    evidence_data,
    created_at,
    source_doc:documents!contradictions_source_execution_doc_id_fkey(title),
    target_doc:documents!contradictions_target_contract_doc_id_fkey(title)
`;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePricingQueueAiMetadata(
    item: Record<string, unknown>
): PricingAiContradictionMetadata | null {
    const rawEvidenceData = item.evidence_data;
    const evidenceData = isRecord(rawEvidenceData) || Array.isArray(rawEvidenceData)
        ? rawEvidenceData
        : null;
    const evidenceObject = isRecord(evidenceData) ? evidenceData : null;
    const pricingEvaluation = isRecord(evidenceObject?.pricing_evaluation)
        ? evidenceObject.pricing_evaluation
        : {};
    const existingMetadata = isRecord(item.ai_metadata) ? item.ai_metadata : {};
    const confidenceScore = getPricingEvidenceConfidenceScore({
        confidence_score: item.confidence_score,
        confidence: item.confidence,
        ai_metadata: existingMetadata,
        evidence_data: evidenceData,
    });
    const linkedIds = Array.isArray(evidenceObject?.linked_ids)
        ? evidenceObject.linked_ids.map((id) => String(id))
        : undefined;
    const missingEvidence = Array.isArray(evidenceObject?.missing_evidence)
        ? evidenceObject.missing_evidence.map((evidence) => String(evidence))
        : undefined;
    const normalizedMetadata: PricingAiContradictionMetadata = {
        ...pricingEvaluation,
        ...existingMetadata,
        confidence_score: confidenceScore,
        comparison_type: String(
            existingMetadata.comparison_type
            ?? pricingEvaluation.comparison_type
            ?? evidenceObject?.comparison_type
            ?? ''
        ) || null,
        evidence_status: String(
            existingMetadata.evidence_status
            ?? pricingEvaluation.evidence_status
            ?? evidenceObject?.evidence_status
            ?? ''
        ) || null,
        linked_ids: linkedIds,
        missing_evidence: missingEvidence,
    };

    return Object.values(normalizedMetadata).some((value) => value !== undefined && value !== null && value !== '')
        ? normalizedMetadata
        : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
    const payload = await response.json();

    if (!response.ok) {
        throw new Error(payload?.error || 'Request failed');
    }

    return payload as T;
}

export async function fetchLedgerRows(projectId: string): Promise<FetchLedgerRowsResult> {
    const supabase = createClient();

    const [{ data, error }, { data: projectData, error: projectError }] = await Promise.all([
        supabase
            .from('pricing_ledger')
            .select(PRICING_LEDGER_SELECT_COLUMNS)
            .eq('project_id', projectId)
            .order('created_at', { ascending: true }),
        supabase
            .from('projects')
            .select('budget')
            .eq('id', projectId)
            .single(),
    ]);

    if (error) {
        throw error;
    }

    if (projectError) {
        throw projectError;
    }

    return {
        rows: (data || []) as unknown as PricingLedgerItem[],
        projectBudget: Number(projectData?.budget || 0),
    };
}

export async function fetchPendingQueue(projectId: string): Promise<PricingContradictionItem[]> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('contradictions')
        .select(PENDING_QUEUE_SELECT_COLUMNS)
        .eq('project_id', projectId)
        .in('status', ['OPEN', 'MOVED_TO_PRICING'])
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    const rows = (data || []) as unknown as Record<string, unknown>[];

    return rows.map((item: Record<string, unknown>) => {
        const aiMetadata = normalizePricingQueueAiMetadata(item);

        return {
            ...item,
            confidence_score: aiMetadata?.confidence_score ?? null,
            ai_metadata: aiMetadata,
            pricing_status: String(item.pricing_status || 'PENDING'),
            source_execution_doc: item.source_doc,
            target_contract_doc: item.target_doc,
        };
    }) as PricingContradictionItem[];
}

export async function updateLedgerRowStatus(
    rowId: string,
    status: PricingLedgerStatusUpdate
): Promise<PricingLedgerApiResult> {
    const response = await fetch('/api/pricing/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: rowId, status }),
    });

    return parseJsonResponse<PricingLedgerApiResult>(response);
}

export async function saveLedgerRow(
    payload: SavePricingLedgerPayload
): Promise<PricingLedgerApiResult> {
    const response = await fetch('/api/pricing/save-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    return parseJsonResponse<PricingLedgerApiResult>(response);
}

export async function deleteLedgerRow(
    projectId: string,
    rowId: string
): Promise<PricingLedgerApiResult> {
    const response = await fetch('/api/pricing/save-ledger', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            project_id: projectId,
            item_id: rowId,
        }),
    });

    return parseJsonResponse<PricingLedgerApiResult>(response);
}

export async function archivePendingQueueItems(
    projectId: string,
    ids: string[]
): Promise<ArchivePricingQueueResult> {
    const requestedIds = normalizePricingQueueIds(ids);

    if (!requestedIds.length) {
        return {
            success: true,
            archivedIds: [],
            skippedIds: [],
        };
    }

    const response = await fetch('/api/pricing/archive-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ids: requestedIds }),
    });

    return parseJsonResponse<ArchivePricingQueueResult>(response);
}

export async function previewHighConfidenceQueueItems(
    projectId: string,
    ids: string[]
): Promise<BulkApprovePreviewResult> {
    const requestedIds = normalizePricingQueueIds(ids);

    if (!requestedIds.length) {
        return {
            success: true,
            stagedIds: [],
            approvedIds: [],
            skippedIds: [],
            threshold: AI_BULK_APPROVE_CONFIDENCE_THRESHOLD,
        };
    }

    const response = await fetch('/api/pricing/bulk-confidence-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ids: requestedIds }),
    });

    return parseJsonResponse<BulkApprovePreviewResult>(response);
}

export async function rescanQueueItem(
    projectId: string,
    item: PricingContradictionItem
): Promise<void> {
    const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId,
            workDocId: item.source_execution_doc_id,
        }),
    });

    if (!response.ok) {
        throw new Error('Scan failed');
    }
}

export async function syncBoqAndContract(projectId: string): Promise<SyncBoqAndContractResult> {
    const response = await fetch('/api/projects/sync-contract-base', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ projectIds: [projectId] }),
    });

    const payload = await parseJsonResponse<ProjectContractBaseSyncResult>(response);

    return {
        syncedContractBase: payload.results?.[0] || null,
    };
}

export function normalizePricingLedgerError(error: unknown): string {
    return getErrorMessage(error, 'Pricing ledger request failed');
}
