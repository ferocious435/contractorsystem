export interface SyncedProjectContractBase {
    projectId: string;
    amount: number | null;
    sourceTitle: string | null;
    strategy: string;
}

export async function syncProjectContractBases(projectIds: string[]): Promise<SyncedProjectContractBase[]> {
    if (!projectIds.length) {
        return [];
    }

    const response = await fetch("/api/projects/sync-contract-base", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectIds }),
    });

    if (!response.ok) {
        throw new Error("Failed to sync project contract amounts");
    }

    const payload = await response.json();
    return payload.results || [];
}

export async function syncSingleProjectContractBase(projectId: string): Promise<SyncedProjectContractBase | null> {
    const results = await syncProjectContractBases([projectId]);
    return results[0] || null;
}
