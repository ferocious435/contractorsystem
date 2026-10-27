import { getLedgerRowAmount } from '@/utils/project-financials';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseGeminiJsonObject(text: string): Record<string, unknown> {
    const cleanText = text.replace(/```json|```/g, '').trim();
    const objectMatch = cleanText.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
        throw new Error('Gemini did not return a JSON object');
    }

    const parsed: unknown = JSON.parse(objectMatch[0]);
    if (!isRecord(parsed)) {
        throw new Error('Gemini did not return a JSON object');
    }

    return parsed;
}

export function normalizeConfidence(value: unknown, fallback = 0.35) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
    if (numericValue <= 1) return numericValue;
    if (numericValue <= 100) return numericValue / 100;
    return 1;
}

export function normalizeNonEmptyStrings(value: unknown, limit = 4) {
    if (!Array.isArray(value)) return [];

    return value
        .map(item => String(item || '').trim())
        .filter(Boolean)
        .slice(0, limit);
}

export function filterPricingQuestions(value: unknown, limit = 3) {
    const normalizedQuestions = normalizeNonEmptyStrings(value, 8);
    const approvalKeywords = ['אישור', 'אישר', 'פרוטוקול', 'ישיבה', 'תקציב', 'תקציבי', 'מנכ', 'הפיקוח'];
    const measurementKeywords = ['כמות', 'שטח', 'אורך', 'נפח', 'קוטר', 'סוג', 'מ"ר', 'מ״ר', 'מ"ק', 'מ״ק', 'יח', 'מספר', 'פירוק', 'פינוי', 'בדיקות'];

    const filteredQuestions = normalizedQuestions.filter(question => {
        const hasApprovalKeyword = approvalKeywords.some(keyword => question.includes(keyword));
        const hasMeasurementKeyword = measurementKeywords.some(keyword => question.includes(keyword));

        // Approval/protocol questions belong in needed_documents unless they directly affect quantity or price.
        if (hasApprovalKeyword && !hasMeasurementKeyword) {
            return false;
        }

        return true;
    });

    return filteredQuestions.slice(0, limit);
}

export function normalizePositiveMoney(value: unknown, fallback: number | null = 0) {
    if (value === null || value === undefined || value === '') return fallback;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
    return Math.round(numericValue * 100) / 100;
}

export function normalizePositiveQuantity(value: unknown, fallback: number | null = null) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
    return numericValue;
}

export function normalizePricingBreakdown(value: unknown, evaluation: Record<string, unknown>) {
    return (Array.isArray(value) ? value : []).flatMap(item => {
        const row = isRecord(item) ? item : {};
        const description = String(row.description || evaluation.suggested_description || '').trim();
        if (!description) return [];
        const quantity = normalizePositiveQuantity(row.quantity);
        const unitPrice = normalizePositiveMoney(row.unit_price_excl_vat, null);
        return [{ ...row, description, item_code: String(row.item_code || ''), unit: String(row.unit || ''),
            quantity, unit_price_excl_vat: unitPrice,
            amount_excl_vat: quantity === null || unitPrice === null ? null
                : getLedgerRowAmount({ quantity, unit_price_excl_vat: unitPrice }) }];
    }).slice(0, 12);
}

export function normalizeEnumValue<T extends string>(
    value: unknown,
    allowedValues: readonly T[],
    fallback: T,
) {
    const normalizedValue = String(value || '').trim().toUpperCase() as T;
    return allowedValues.includes(normalizedValue) ? normalizedValue : fallback;
}

export function looksLikeLumpSumUnit(unit: unknown) {
    const normalizedUnit = String(unit || '').trim().toLowerCase();
    return ['קומפ', 'קומפלט', 'פאושל', 'יחידה קומפלטית', 'lump sum', 'ls'].includes(normalizedUnit);
}

export interface NormalizePricingEvaluationTextFallbacks {
    zeroMatchWithDraftPrice: string;
    zeroMatchWithoutDraftPrice: string;
    zeroMatchQuestions: string[];
    quantityReviewQuestion: string;
}

export interface NormalizePricingEvaluationContext {
    hasSourceMatches: boolean;
    textFallbacks: NormalizePricingEvaluationTextFallbacks;
}

export const DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS: NormalizePricingEvaluationTextFallbacks = {
    zeroMatchWithDraftPrice: 'לא נמצא מקור מחיר מאומת ומתאים לעבודה; המחיר והכמות נשארים לבדיקה.',
    zeroMatchWithoutDraftPrice: 'לא נמצא סעיף מתאים עם בסיס מחיר מאומת. נדרש להשלים את המקור או לסמן מחיר ידני מפורש.',
    zeroMatchQuestions: [
        'מה הכמות או השטח שבוצעו בפועל?',
        'מה סוג החומר, הגמר או הרכיב שנדרש בפועל?',
        'האם יש פירוק, פינוי או עבודות נלוות שמשפיעות על המחיר?',
    ],
    quantityReviewQuestion: 'יש לאשר את הכמות, השטח או האורך שבוצעו בפועל לפני אישור סופי של הסכום.',
};

export function normalizePricingEvaluation(
    evaluation: Record<string, unknown>,
    context: NormalizePricingEvaluationContext,
) {
    evaluation.confidence = normalizeConfidence(evaluation.confidence);
    evaluation.confidence_score = evaluation.confidence;
    evaluation.needed_documents = normalizeNonEmptyStrings(evaluation.needed_documents, 4);
    evaluation.source_basis = normalizeNonEmptyStrings(evaluation.source_basis, 6);
    evaluation.questions = filterPricingQuestions(evaluation.questions, 3);
    const scope = isRecord(evaluation.scope_review) ? evaluation.scope_review : null;
    if (!scope || scope.version !== 'price-scope-v1' || !context.hasSourceMatches) {
        evaluation.match_found = false;
        evaluation.source = 'CUSTOM_ANALYSIS';
        evaluation.match_quality = 'ZERO_MATCH';
        evaluation.suggested_unit_price_excl_vat = null;
        evaluation.suggested_quantity = null;
        evaluation.total_excl_vat = null;
        evaluation.pricing_breakdown = [];
        evaluation.confidence = Math.min(Number(evaluation.confidence), 0.45);
        evaluation.confidence_score = evaluation.confidence;
        evaluation.quantity_review_required = true;
        evaluation.requires_user_answer_before_approval = true;
        evaluation.zero_match_reason = context.textFallbacks.zeroMatchWithoutDraftPrice;
        evaluation.questions = Array.isArray(evaluation.questions) && evaluation.questions.length ? evaluation.questions : [context.textFallbacks.quantityReviewQuestion];
        return evaluation;
    }
    const quantity = evaluation.suggested_quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) evaluation.suggested_quantity = null;
    const price = evaluation.suggested_unit_price_excl_vat;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) evaluation.suggested_unit_price_excl_vat = null;
    evaluation.quantity_review_required = evaluation.suggested_quantity === null;
    evaluation.requires_user_answer_before_approval = Boolean(scope.requiresReview)
        || evaluation.suggested_quantity === null || evaluation.suggested_unit_price_excl_vat === null;
    return evaluation;
}
