import { createClient } from '@/utils/supabase/client';
import type {
    FetchLedgerRowsResult,
    PricingContradictionItem,
    PricingLedgerApiResult,
    PricingLedgerItem,
    PricingLedgerStatusUpdate,
    ProjectContractBaseSyncResult,
    SavePricingLedgerPayload,
    SyncBoqAndContractResult,
} from '../types';

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
            .select('*')
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
        rows: (data || []) as PricingLedgerItem[],
        projectBudget: Number(projectData?.budget || 0),
    };
}

export async function fetchPendingQueue(projectId: string): Promise<PricingContradictionItem[]> {
    const supabase = createClient();

    const { data, error } = await supabase
        .from('contradictions')
        .select(`
            *,
            source_doc:documents!contradictions_source_execution_doc_id_fkey(title),
            target_doc:documents!contradictions_target_contract_doc_id_fkey(title)
        `)
        .eq('project_id', projectId)
        .in('status', ['OPEN', 'MOVED_TO_PRICING', 'PENDING'])
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    return (data || []).map((item: Record<string, unknown>) => ({
        ...item,
        pricing_status: String(item.pricing_status || 'PENDING'),
        source_execution_doc: item.source_doc,
        target_contract_doc: item.target_doc,
    })) as PricingContradictionItem[];
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

export async function deleteLedgerRow(rowId: string): Promise<PricingLedgerApiResult> {
    const supabase = createClient();

    const { data: ledgerRow, error: lookupError } = await supabase
        .from('pricing_ledger')
        .select('id, type, project_id')
        .eq('id', rowId)
        .maybeSingle();

    if (lookupError) {
        throw lookupError;
    }

    if (!ledgerRow) {
        return { success: false, error: 'Ledger row not found or forbidden' };
    }

    if (ledgerRow.type === 'BASE_CONTRACT') {
        return { success: false, error: 'Base contract rows are read-only' };
    }

    const response = await fetch('/api/pricing/save-ledger', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            project_id: ledgerRow.project_id,
            item_id: rowId,
        }),
    });

    return parseJsonResponse<PricingLedgerApiResult>(response);
}

export async function archivePendingQueueItems(ids: string[]): Promise<void> {
    if (!ids.length) {
        return;
    }

    const supabase = createClient();
    const { error } = await supabase
        .from('contradictions')
        .update({ status: 'ARCHIVED' })
        .in('id', ids);

    if (error) {
        throw error;
    }
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
