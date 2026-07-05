interface SupabaseMutationResult {
    error: unknown;
}

interface SupabaseMutationQuery extends PromiseLike<SupabaseMutationResult> {
    eq(column: string, value: unknown): SupabaseMutationQuery;
}

interface SupabaseMutationClient {
    from(table: string): {
        update(values: Record<string, unknown>): SupabaseMutationQuery;
    };
}

export async function markContradictionAsPriced(
    supabase: SupabaseMutationClient,
    contradictionId: unknown,
    projectId: unknown,
): Promise<void> {
    if (!contradictionId) {
        return;
    }

    const result = await supabase
        .from('contradictions')
        .update({ pricing_status: 'PRICED', status: 'MOVED_TO_PRICING' })
        .eq('id', contradictionId)
        .eq('project_id', projectId);

    if (result.error) {
        throw result.error;
    }
}
