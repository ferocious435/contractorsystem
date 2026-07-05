export interface LocalDemoProjectProfile {
    budget: number;
    approvedVO: number;
    pendingVO: number;
    criticalCount: number;
    totalDiscrepancies: number;
    documentCount: number;
    evidenceCoverage: number;
    clientName: string;
}

const DEFAULT_LOCAL_PROFILE: LocalDemoProjectProfile = {
    budget: 0,
    approvedVO: 0,
    pendingVO: 0,
    criticalCount: 0,
    totalDiscrepancies: 0,
    documentCount: 0,
    evidenceCoverage: 0,
    clientName: 'Local client',
};

const DEMO_PROJECT_PROFILES: Record<string, LocalDemoProjectProfile> = {
    'demo-project-main': {
        budget: 125000,
        approvedVO: 14750,
        pendingVO: 9200,
        criticalCount: 2,
        totalDiscrepancies: 3,
        documentCount: 4,
        evidenceCoverage: 78,
        clientName: 'Demo client',
    },
    'demo-project-site': {
        budget: 38000,
        approvedVO: 4200,
        pendingVO: 2600,
        criticalCount: 1,
        totalDiscrepancies: 2,
        documentCount: 3,
        evidenceCoverage: 72,
        clientName: 'Free trial client',
    },
};

export function getLocalDemoProjectProfile(projectId: string | null | undefined): LocalDemoProjectProfile {
    if (!projectId) return DEFAULT_LOCAL_PROFILE;
    return DEMO_PROJECT_PROFILES[projectId] || DEFAULT_LOCAL_PROFILE;
}
