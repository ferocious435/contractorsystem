export type ContradictionReviewInput = {
    title: string;
    description: string;
    category: string;
    severity: string;
    strategyAdvice: string;
    verdict: string;
    comparisonType: string;
    missingEvidence?: string[];
};

const ALLOWED_SEVERITIES = new Set(['HIGH', 'MEDIUM', 'LOW']);
const ALLOWED_VERDICTS = new Set([
    'CONFIRMED',
    'REFRAMED_NOT_CONTRACT_CONTRADICTION',
    'REQUIRES_REVIEW',
]);

function requiredText(value: unknown, field: string, maxLength: number) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${field} is required`);
    }
    const clean = value.trim();
    if (clean.length > maxLength) throw new Error(`${field} is too long`);
    return clean;
}
export function buildContradictionReviewUpdate(
    existingEvidence: unknown,
    review: ContradictionReviewInput,
    reviewedAt = new Date().toISOString(),
) {
    const severity = requiredText(review.severity, 'severity', 20).toUpperCase();
    const verdict = requiredText(review.verdict, 'verdict', 80).toUpperCase();
    if (!ALLOWED_SEVERITIES.has(severity)) throw new Error('Unsupported review severity');
    if (!ALLOWED_VERDICTS.has(verdict)) throw new Error('Unsupported review verdict');

    const evidence = existingEvidence && typeof existingEvidence === 'object' && !Array.isArray(existingEvidence)
        ? existingEvidence as Record<string, unknown>
        : {};
    const missingEvidence = Array.isArray(review.missingEvidence)
        ? review.missingEvidence
            .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
            .map((item) => item.trim())
            .slice(0, 20)
        : [];

    return {
        title: requiredText(review.title, 'title', 180),
        description: requiredText(review.description, 'description', 2_000),
        category: requiredText(review.category, 'category', 100),
        severity,
        strategy_advice: requiredText(review.strategyAdvice, 'strategyAdvice', 2_000),
        evidence_data: {
            ...evidence,
            evidence_status: verdict === 'CONFIRMED' ? 'VERIFIED' : 'REQUIRES_VERIFICATION',
            comparison_type: requiredText(review.comparisonType, 'comparisonType', 100),
            missing_evidence: missingEvidence,
            confidence: verdict === 'CONFIRMED' ? evidence.confidence ?? null : null,
            manual_review: {
                verdict,
                reviewed_at: reviewedAt,
                source: 'controlled_source_review',
            },
        },
    };
}
