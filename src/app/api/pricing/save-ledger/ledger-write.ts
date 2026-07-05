import type { SupabaseClient } from '@supabase/supabase-js';

interface LedgerWritePayload {
    [key: string]: unknown;
}

function selectSavedLedgerRow(query: {
    select(columns: string): {
        single(): unknown;
    };
}) {
    return query
        .select(`
            *,
            projects ( id, name )
        `)
        .single() as unknown as PromiseLike<{ data: unknown; error: unknown }>;
}

export async function updateMutableLedgerRow(
    supabase: SupabaseClient,
    rowId: unknown,
    projectId: unknown,
    payload: LedgerWritePayload,
) {
    const { data, error } = await selectSavedLedgerRow(
        supabase
            .from('pricing_ledger')
            .update(payload)
            .eq('id', rowId)
            .eq('project_id', projectId)
            .neq('type', 'BASE_CONTRACT')
    );

    if (error) {
        throw error;
    }

    return data;
}

export async function insertMutableLedgerRow(
    supabase: SupabaseClient,
    projectId: unknown,
    contradictionId: unknown,
    payload: LedgerWritePayload,
) {
    const { data, error } = await selectSavedLedgerRow(
        supabase
            .from('pricing_ledger')
            .insert({
                project_id: projectId,
                contradiction_id: contradictionId,
                ...payload,
            })
    );

    if (error) {
        throw error;
    }

    return data;
}

export async function upsertMutableLedgerRowByContradiction(
    supabase: SupabaseClient,
    projectId: unknown,
    contradictionId: unknown,
    payload: LedgerWritePayload,
) {
    const { data, error } = await selectSavedLedgerRow(
        supabase
            .from('pricing_ledger')
            .upsert({
                project_id: projectId,
                contradiction_id: contradictionId,
                ...payload,
            }, {
                onConflict: 'project_id,contradiction_id',
            })
    );

    if (error) {
        throw error;
    }

    return data;
}
