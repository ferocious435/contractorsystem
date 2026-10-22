type RetryState = { work_doc_id: string; status?: string | null; updated_at?: string | null };

export function buildScanRetryQueue(orderedWorkDocuments: Array<{ id: string }>, states: RetryState[]) {
    const latest = new Map<string, RetryState>();
    for (const state of states) {
        const previous = latest.get(state.work_doc_id);
        if (!previous || String(state.updated_at || '') > String(previous.updated_at || '')) {
            latest.set(state.work_doc_id, state);
        }
    }
    return orderedWorkDocuments.flatMap((document, cursor) =>
        ['SKIPPED', 'ERROR'].includes(String(latest.get(document.id)?.status || ''))
            ? [{ id: document.id, cursor }] : []);
}
