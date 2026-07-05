import { normalizeConfidenceScore } from '../../../../utils/pricing-confidence';

export function normalizeLedgerEvidenceData(value: unknown): Record<string, unknown> {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
        return {};
    }

    const evidenceData = value as Record<string, unknown>;
    const pricingEvaluation = evidenceData.pricing_evaluation;

    if (!pricingEvaluation || Array.isArray(pricingEvaluation) || typeof pricingEvaluation !== 'object') {
        return evidenceData;
    }

    const pricingEvaluationData = pricingEvaluation as Record<string, unknown>;
    const confidenceScore = normalizeConfidenceScore(
        pricingEvaluationData.confidence_score ?? pricingEvaluationData.confidence
    );

    if (confidenceScore === null) {
        return evidenceData;
    }

    return {
        ...evidenceData,
        pricing_evaluation: {
            ...pricingEvaluationData,
            confidence_score: confidenceScore,
        },
    };
}
