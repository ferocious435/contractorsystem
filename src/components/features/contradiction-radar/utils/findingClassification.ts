import type { ContradictionItem } from '@/types';

export type RadarFindingFilter =
    | 'ALL'
    | 'CONTRADICTION'
    | 'VARIATION'
    | 'SITE_EVENT'
    | 'MISSING_INFO'
    | 'NO_DIRECT_MATCH';

export interface RadarFindingFilterOption {
    id: RadarFindingFilter;
    label: string;
    count: number;
    tone: 'neutral' | 'red' | 'blue' | 'emerald' | 'amber' | 'slate';
}

export interface RadarFindingCountSummary {
    all: number;
    contradictions: number;
    variations: number;
    siteEvents: number;
    missingInfo: number;
    noDirectMatch: number;
}

function includesAny(value: string, patterns: string[]) {
    return patterns.some((pattern) => value.includes(pattern));
}

export function getRadarFindingKind(item: ContradictionItem): Exclude<RadarFindingFilter, 'ALL'> {
    const category = String(item.category || '').toLowerCase();
    const comparisonType = String(item.evidence_data?.comparison_type || '').toLowerCase();

    if (
        item.severity === 'HIGH' ||
        includesAny(category, ['סתירה', 'contradiction'])
    ) {
        return 'CONTRADICTION';
    }

    if (includesAny(category, ['שינוי', 'חריג', 'change', 'extra', 'variation'])) {
        return 'VARIATION';
    }

    if (includesAny(category, ['חוסר נתונים', 'missing data']) || comparisonType.includes('missing_data')) {
        return 'MISSING_INFO';
    }

    if (
        includesAny(category, ['אין התאמה ישירה', 'no direct match']) ||
        comparisonType.includes('zero_match')
    ) {
        return 'NO_DIRECT_MATCH';
    }

    return 'SITE_EVENT';
}

export function getRadarFindingReference(item: ContradictionItem) {
    const storedRef = item.evidence_data?.finding_ref || item.evidence_data?.display_ref;
    if (typeof storedRef === 'string' && storedRef.trim()) {
        return storedRef.trim();
    }

    const prefixByKind: Record<Exclude<RadarFindingFilter, 'ALL'>, string> = {
        CONTRADICTION: 'C',
        VARIATION: 'VO',
        SITE_EVENT: 'SITE',
        MISSING_INFO: 'INFO',
        NO_DIRECT_MATCH: 'MATCH',
    };
    const idPart = String(item.id || '').replace(/-/g, '').slice(0, 6).toUpperCase() || '000000';

    return `${prefixByKind[getRadarFindingKind(item)]}-${idPart}`;
}

export function buildRadarFindingCounts(items: ContradictionItem[]): RadarFindingCountSummary {
    return items.reduce<RadarFindingCountSummary>((counts, item) => {
        const kind = getRadarFindingKind(item);
        counts.all += 1;

        if (kind === 'CONTRADICTION') counts.contradictions += 1;
        if (kind === 'VARIATION') counts.variations += 1;
        if (kind === 'SITE_EVENT') counts.siteEvents += 1;
        if (kind === 'MISSING_INFO') counts.missingInfo += 1;
        if (kind === 'NO_DIRECT_MATCH') counts.noDirectMatch += 1;

        return counts;
    }, {
        all: 0,
        contradictions: 0,
        variations: 0,
        siteEvents: 0,
        missingInfo: 0,
        noDirectMatch: 0,
    });
}

export function filterRadarFindings(items: ContradictionItem[], filter: RadarFindingFilter) {
    if (filter === 'ALL') return items;
    return items.filter((item) => getRadarFindingKind(item) === filter);
}

export function buildRadarFindingFilterOptions(counts: RadarFindingCountSummary): RadarFindingFilterOption[] {
    return [
        { id: 'ALL', label: 'כל הממצאים', count: counts.all, tone: 'neutral' },
        { id: 'CONTRADICTION', label: 'סתירות', count: counts.contradictions, tone: 'red' },
        { id: 'VARIATION', label: 'שינויים / חריגים', count: counts.variations, tone: 'blue' },
        { id: 'SITE_EVENT', label: 'אירועי שטח', count: counts.siteEvents, tone: 'emerald' },
        { id: 'MISSING_INFO', label: 'חסר מידע', count: counts.missingInfo, tone: 'amber' },
        { id: 'NO_DIRECT_MATCH', label: 'אין התאמה ישירה', count: counts.noDirectMatch, tone: 'slate' },
    ];
}
