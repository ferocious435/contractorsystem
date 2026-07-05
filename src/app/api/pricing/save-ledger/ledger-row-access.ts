import type { SupabaseClient } from '@supabase/supabase-js';

export interface SaveLedgerRowRef {
    id: string;
    type: string;
}

export async function findLedgerRowById(
    supabase: SupabaseClient,
    rowId: unknown,
    projectId: unknown,
): Promise<SaveLedgerRowRef | null> {
    const { data, error } = await supabase
        .from('pricing_ledger')
        .select('id, type')
        .eq('id', rowId)
        .eq('project_id', projectId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || null;
}

export async function findLedgerRowByContradiction(
    supabase: SupabaseClient,
    projectId: unknown,
    contradictionId: unknown,
): Promise<SaveLedgerRowRef | null> {
    const { data, error } = await supabase
        .from('pricing_ledger')
        .select('id, type')
        .eq('project_id', projectId)
        .eq('contradiction_id', contradictionId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || null;
}

export function isReadOnlyBaseContractRow(row: SaveLedgerRowRef | null): boolean {
    return row?.type === 'BASE_CONTRACT';
}
