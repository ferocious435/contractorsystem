import type { ContradictionItem } from '@/types';
import { isTechnicalRadarExclusion } from '../../../../utils/radar-review-disposition.ts';
import { getEvidenceDisplayStatus } from './evidenceVerification.ts';

export type RadarFindingFilter =
    | 'ALL'
    | 'CONTRADICTION'
    | 'VARIATION'
    | 'SITE_EVENT'
    | 'MISSING_INFO'
    | 'NO_DIRECT_MATCH';

export type RadarStatusFilter = 'OPEN' | 'MOVED_TO_PRICING' | 'ARCHIVED';

export function getRadarStatus(item: { status?: string | null }): RadarStatusFilter {
    if (['ARCHIVED','AUTO_RESOLVED','IGNORED','RESOLVED'].includes(String(item.status))) return 'ARCHIVED';
    return item.status === 'MOVED_TO_PRICING' ? 'MOVED_TO_PRICING' : 'OPEN';
}

export interface RadarStatusFilterOption {
    id: RadarStatusFilter;
    label: string;
    count: number;
}

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
    const semantic = item.evidence_data?.semantic_assessment as Record<string, unknown> | undefined;
    if (semantic?.version === 'evidence-relation-v1') {
        if (semantic.resultType === 'KNOWN_CHANGE') return 'VARIATION';
        if (semantic.resultType === 'EVENT') return 'SITE_EVENT';
        if (semantic.resultType === 'NEEDS_VERIFICATION') return 'MISSING_INFO';
        if (semantic.resultType === 'CONTRADICTION') return getEvidenceDisplayStatus(item.evidence_data) === 'SOURCE_VERIFIED'
            ? 'CONTRADICTION' : 'MISSING_INFO';
        if (semantic.resultType === 'NO_CONFLICT') return getEvidenceDisplayStatus(item.evidence_data) === 'NO_CONFLICT'
            ? 'NO_DIRECT_MATCH' : 'MISSING_INFO';
    }

    if (
        includesAny(category, ['סתירה', 'contradiction'])
    ) {
        return 'MISSING_INFO';
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
        if (isTechnicalRadarExclusion(item)) return counts;
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

export function filterRadarFindings(
    items: ContradictionItem[],
    filter: RadarFindingFilter,
    statusFilter?: RadarStatusFilter
) {
    const visible = items.filter(item => !isTechnicalRadarExclusion(item));
    const itemsWithStatus = statusFilter ? visible.filter((item) => getRadarStatus(item) === statusFilter) : visible;

    if (filter === 'ALL') return itemsWithStatus;
    return itemsWithStatus.filter((item) => getRadarFindingKind(item) === filter);
}

export function buildRadarStatusFilterOptions(items: ContradictionItem[]): RadarStatusFilterOption[] {
    const countByStatus = items.reduce<Record<RadarStatusFilter, number>>((counts, item) => {
        if (isTechnicalRadarExclusion(item)) return counts;
        counts[getRadarStatus(item)] += 1;
        return counts;
    }, {
        OPEN: 0,
        MOVED_TO_PRICING: 0,
        ARCHIVED: 0,
    });

    return [
        { id: 'OPEN', label: 'פתוחים', count: countByStatus.OPEN },
        { id: 'MOVED_TO_PRICING', label: 'הועברו לתמחור', count: countByStatus.MOVED_TO_PRICING },
        { id: 'ARCHIVED', label: 'ארכיון', count: countByStatus.ARCHIVED },
    ];
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
