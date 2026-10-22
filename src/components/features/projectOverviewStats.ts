import { isTechnicalRadarExclusion } from '../../utils/radar-review-disposition.ts';

interface ContradictionStatusRow {
    status?: string | null;
    severity?: string | null;
    evidence_data?: unknown;
}

export function summarizeOpenContradictions(items: ContradictionStatusRow[] | null | undefined) {
    const openItems = (items || []).filter((item) => item.status === 'OPEN' && !isTechnicalRadarExclusion(item));

    return {
        openCount: openItems.length,
        highRiskOpenCount: openItems.filter((item) => item.severity === 'HIGH').length,
    };
}
