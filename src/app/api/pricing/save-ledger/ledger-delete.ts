import type { SupabaseClient } from '@supabase/supabase-js';

export async function deleteMutableLedgerRow(
    supabase: SupabaseClient,
    rowId: unknown,
    projectId: unknown,
): Promise<void> {
    const { error } = await supabase
        .from('pricing_ledger')
        .delete()
        .eq('id', rowId)
        .eq('project_id', projectId)
        .neq('type', 'BASE_CONTRACT');

    if (error) {
        throw error;
    }
}
