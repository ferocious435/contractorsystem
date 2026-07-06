export function isLocalProjectId(projectId: string | null | undefined) {
    return Boolean(projectId && (projectId.startsWith('local-') || projectId.startsWith('demo-')));
}

export function isDemoProjectId(projectId: string | null | undefined) {
    return Boolean(projectId && projectId.startsWith('demo-'));
}
