import type { PricingContradictionItem } from '../types';

function asFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeConfidenceScore(value: unknown): number | null {
    const parsed = asFiniteNumber(value);

    if (parsed === null || parsed < 0) {
        return null;
    }

    if (parsed <= 1) {
        return parsed;
    }

    if (parsed <= 100) {
        return parsed / 100;
    }

    return 1;
}

export function getQueueItemConfidenceScore(item: PricingContradictionItem): number | null {
    const evidenceData = item.evidence_data;
    const evidenceObject = !Array.isArray(evidenceData) && evidenceData ? evidenceData : null;
    const pricingEvaluation = evidenceObject?.pricing_evaluation as Record<string, unknown> | undefined;

    return normalizeConfidenceScore(
        item.confidence_score
        ?? item.ai_metadata?.confidence_score
        ?? pricingEvaluation?.confidence_score
        ?? pricingEvaluation?.confidence
        ?? evidenceObject?.confidence_score
        ?? evidenceObject?.confidence
    );
}

export function formatConfidencePercent(score: number | null): string {
    if (score === null) {
        return '--';
    }

    return `${Math.round(score * 100)}%`;
}
