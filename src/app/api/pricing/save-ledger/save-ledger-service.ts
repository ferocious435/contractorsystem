import { deleteMutableLedgerRow } from './ledger-delete';
import { normalizeSaveLedgerInput } from './ledger-input';
import { markContradictionAsPriced } from './ledger-queue-status';
import {
    findLedgerRowByContradiction,
    findLedgerRowById,
    isReadOnlyBaseContractRow,
} from './ledger-row-access';
import {
    insertMutableLedgerRow,
    upsertMutableLedgerRowByContradiction,
    updateMutableLedgerRow,
} from './ledger-write';
import { verifyProjectOwnership } from './project-access';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canAutomaticallyPriceFinding } from '@/utils/radar-review-disposition';

interface SaveLedgerServiceResult {
    body: Record<string, unknown>;
    status: number;
}

function serviceResult(body: Record<string, unknown>, status = 200): SaveLedgerServiceResult {
    return { body, status };
}

export async function saveLedgerItem(
    supabase: SupabaseClient,
    contractorId: unknown,
    data: Record<string, unknown>,
): Promise<SaveLedgerServiceResult> {
    const projectId = data.project_id;

    if (!projectId) {
        return serviceResult({ error: 'project_id is required' }, 400);
    }

    const hasProjectAccess = await verifyProjectOwnership(supabase, projectId, contractorId);

    if (!hasProjectAccess) {
        return serviceResult({ error: 'Project not found or forbidden' }, 403);
    }

    const normalizedInput = normalizeSaveLedgerInput(data);
    if (!normalizedInput.ok) {
        return serviceResult({ error: normalizedInput.error }, normalizedInput.status);
    }

    const { itemId, activeContradictionId, ledgerMutationPayload } = normalizedInput.value;

    if (itemId) {
        const existingLedgerItem = await findLedgerRowById(supabase, itemId, projectId);

        if (!existingLedgerItem) {
            return serviceResult({ error: 'Ledger item not found or forbidden' }, 404);
        }

        if (isReadOnlyBaseContractRow(existingLedgerItem)) {
            return serviceResult({ error: 'Base contract rows are read-only' }, 400);
        }

        const updatedLedgerItem = await updateMutableLedgerRow(
            supabase,
            existingLedgerItem.id,
            projectId,
            ledgerMutationPayload,
        );

        return serviceResult({ success: true, item: updatedLedgerItem });
    }

    if (activeContradictionId) {
        const existingLedgerItem = await findLedgerRowByContradiction(supabase, projectId, activeContradictionId);
        const { data: finding, error: findingError } = await supabase.from('contradictions').select('id,status,evidence_data')
            .eq('id',activeContradictionId).eq('project_id',projectId).maybeSingle();
        if (findingError) throw findingError;
        if (!finding) return serviceResult({ error: 'Finding not found in project' },404);
        const eligible = canAutomaticallyPriceFinding(finding);
        if (!eligible && !existingLedgerItem) return serviceResult({ error: 'הממצא הוחרג או נסגר; לא ניתן ליצור ממנו חישוב חדש.' },409);

        if (isReadOnlyBaseContractRow(existingLedgerItem)) {
            return serviceResult({ error: 'Base contract rows are read-only' }, 400);
        }

        const savedLedgerItem = await upsertMutableLedgerRowByContradiction(
            supabase,
            projectId,
            activeContradictionId,
            ledgerMutationPayload,
        );

        if (eligible) await markContradictionAsPriced(supabase, activeContradictionId, projectId);

        return serviceResult({ success: true, item: savedLedgerItem });
    }

    const newLedgerItem = await insertMutableLedgerRow(
        supabase,
        projectId,
        activeContradictionId,
        ledgerMutationPayload,
    );

    await markContradictionAsPriced(supabase, activeContradictionId, projectId);

    return serviceResult({ success: true, item: newLedgerItem });
}

export async function deleteLedgerItem(
    supabase: SupabaseClient,
    contractorId: unknown,
    data: Record<string, unknown>,
): Promise<SaveLedgerServiceResult> {
    const { item_id, project_id } = data;

    if (!item_id || !project_id) {
        return serviceResult({ error: 'item_id and project_id are required' }, 400);
    }

    const hasProjectAccess = await verifyProjectOwnership(supabase, project_id, contractorId);

    if (!hasProjectAccess) {
        return serviceResult({ error: 'Project not found or forbidden' }, 403);
    }

    const ledgerItem = await findLedgerRowById(supabase, item_id, project_id);

    if (!ledgerItem) {
        return serviceResult({ error: 'Ledger item not found or forbidden' }, 404);
    }

    if (isReadOnlyBaseContractRow(ledgerItem)) {
        return serviceResult({ error: 'Base contract rows are read-only' }, 400);
    }

    await deleteMutableLedgerRow(supabase, item_id, project_id);

    return serviceResult({ success: true });
}
