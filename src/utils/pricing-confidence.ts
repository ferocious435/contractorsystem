export interface PricingConfidenceEvidenceCarrier {
    confidence_score?: unknown;
    confidence?: unknown;
    ai_metadata?: {
        confidence_score?: unknown;
    } | null;
    evidence_data?: Record<string, unknown> | unknown[] | null;
}

export const AI_BULK_APPROVE_CONFIDENCE_THRESHOLD = 0.9;

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

export function getPricingEvidenceConfidenceScore(item: PricingConfidenceEvidenceCarrier): number | null {
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
