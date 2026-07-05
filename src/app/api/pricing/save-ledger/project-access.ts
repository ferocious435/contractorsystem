import type { SupabaseClient } from '@supabase/supabase-js';

export async function verifyProjectOwnership(
    supabase: SupabaseClient,
    projectId: unknown,
    contractorId: unknown,
): Promise<boolean> {
    const { data, error } = await supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('contractor_id', contractorId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data);
}
