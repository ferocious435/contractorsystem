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
import { assessPricingScopeApproval, type ManualPricingInputs } from '@/utils/pricing-scope-approval';
import type { PricingScopeResult } from '@/utils/pricing-scope-review';
import { loadPricingScopeContext } from '@/utils/pricing-scope-sources-server';
import { pricingScopeSignature } from '@/utils/pricing-scope-signature';

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

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

        const canonical = asRecord(asRecord(finding.evidence_data).pricing_evaluation);
        const scope = asRecord(canonical.scope_review);
        const incoming = asRecord(ledgerMutationPayload.evidence_data);
        if (scope.version === 'price-scope-v1' || incoming.pricing_evaluation || (!existingLedgerItem && Object.keys(canonical).length > 0)) {
            if (scope.version !== 'price-scope-v1') return serviceResult({ error: 'נדרשת בדיקת מקור והתאמת סעיף לפני תמחור אוטומטי.' }, 409);
            if (typeof canonical.scope_source_signature !== 'string')
                return serviceResult({ error: 'טרם אומתו המקורות של הבדיקה. נדרשת בדיקת מחיר מעודכנת.' }, 409);
            {
                const current = await loadPricingScopeContext({ supabase, projectId: String(projectId), findingId: String(activeContradictionId) });
                if (canonical.scope_source_signature !== pricingScopeSignature(current))
                    return serviceResult({ error: 'המקורות השתנו מאז הבדיקה. נדרש לעדכן את בדיקת המחיר לפני שמירה.' }, 409);
            }
            const rawManual = asRecord(data.manual_pricing_inputs);
            const manual: ManualPricingInputs = {};
            for (const key of ['quantity', 'unitPriceExclVat', 'markupPercent'] as const) {
                if (typeof rawManual[key] === 'number' && Number.isFinite(rawManual[key])) manual[key] = rawManual[key];
            }
            const approval = assessPricingScopeApproval(scope as PricingScopeResult, manual);
            if (!approval.allowed) return serviceResult({ error: approval.reason }, 409);
            const same = (left: unknown, right: number | null) => right !== null && typeof left === 'number' && Math.abs(left - right) < 0.000001;
            if (!same(ledgerMutationPayload.quantity, approval.quantity)
                || !same(ledgerMutationPayload.unit_price_excl_vat, approval.effectiveUnitPriceExclVat)
                || !same(Number(ledgerMutationPayload.markup_percentage || 0) * 100, approval.markupPercent)
                || (canonical.suggested_unit && String(ledgerMutationPayload.unit || '') !== String(canonical.suggested_unit))) {
                return serviceResult({ error: 'הנתונים שונים מהמקור; שינוי מספר דורש סימון ידני מפורש ויחידה תואמת.' }, 409);
            }
            ledgerMutationPayload.evidence_data = { ...incoming, pricing_evaluation: canonical, manual_pricing_inputs: manual,
                pricing_approval: { total_excl_vat: approval.totalExclVat, quantity: approval.quantity,
                    effective_unit_price_excl_vat: approval.effectiveUnitPriceExclVat, reviewed_by: contractorId } };
            ledgerMutationPayload.source = manual.unitPriceExclVat !== undefined || manual.markupPercent
                ? 'CUSTOM_ANALYSIS' : canonical.source || 'CUSTOM_ANALYSIS';
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
