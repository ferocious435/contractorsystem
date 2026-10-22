export const RADAR_FINDINGS_UPDATED_EVENT = 'radar-findings-updated';

export function isTechnicalRadarExclusion(item: { evidence_data?: unknown }) {
    const evidence = item.evidence_data && typeof item.evidence_data === 'object'
        ? item.evidence_data as Record<string, unknown> : {};
    const disposition = evidence.review_disposition && typeof evidence.review_disposition === 'object'
        ? evidence.review_disposition as Record<string, unknown> : {};
    return disposition.type === 'INVALID_AUTOMATIC_FINDING' || disposition.type === 'DUPLICATE';
}
