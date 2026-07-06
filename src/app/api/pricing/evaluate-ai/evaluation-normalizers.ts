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

export function normalizePositiveMoney(value: unknown, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
    return Math.round(numericValue * 100) / 100;
}

export function normalizePositiveQuantity(value: unknown, fallback = 1) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
    return numericValue;
}

export function normalizePricingBreakdown(value: unknown, evaluation: Record<string, unknown>) {
    const rows = Array.isArray(value) ? value : [];
    const normalizedRows = rows
        .map((item: unknown, index: number) => {
            const row = isRecord(item) ? item : {};
            const evaluationSource = normalizeEnumValue(
                evaluation.source,
                ['BOQ', 'HOUSING_MINISTRY', 'DEKEL', 'CONTRACTOR', 'CUSTOM_ANALYSIS'] as const,
                'CUSTOM_ANALYSIS',
            );
            const quantity = normalizePositiveQuantity(row?.quantity, 1);
            const unitPrice = normalizePositiveMoney(row?.unit_price_excl_vat, 0);
            const amount = normalizePositiveMoney(row?.amount_excl_vat, quantity * unitPrice);

            return {
                item_code: String(row?.item_code || `DRAFT-${index + 1}`).trim(),
                source: normalizeEnumValue(
                    row?.source,
                    ['BOQ', 'HOUSING_MINISTRY', 'DEKEL', 'CONTRACTOR', 'CUSTOM_ANALYSIS'] as const,
                    evaluationSource,
                ),
                source_name: String(row?.source_name || row?.source || evaluationSource).trim(),
                description: String(row?.description || evaluation.suggested_description || evaluation.ai_rationale || '').trim(),
                unit: String(row?.unit || evaluation.suggested_unit || '').trim(),
                quantity,
                unit_price_excl_vat: unitPrice,
                amount_excl_vat: amount,
                basis: String(row?.basis || '').trim(),
                is_inference: Boolean(row?.is_inference || row?.source === 'CUSTOM_ANALYSIS' || evaluation.source === 'CUSTOM_ANALYSIS'),
            };
        })
        .filter((row) => row.description && row.unit_price_excl_vat >= 0);

    if (normalizedRows.length > 0) {
        return normalizedRows.slice(0, 12);
    }

    const draftUnitPrice = normalizePositiveMoney(evaluation.suggested_unit_price_excl_vat, 0);
    const evaluationSource = normalizeEnumValue(
        evaluation.source,
        ['BOQ', 'HOUSING_MINISTRY', 'DEKEL', 'CONTRACTOR', 'CUSTOM_ANALYSIS'] as const,
        'CUSTOM_ANALYSIS',
    );
    if (draftUnitPrice <= 0) {
        return [];
    }

    const quantity = normalizePositiveQuantity(evaluation.suggested_quantity, 1);
    return [{
        item_code: String(evaluation.item_code || 'DRAFT-1'),
        source: evaluationSource,
        source_name: evaluationSource,
        description: String(evaluation.suggested_description || evaluation.ai_rationale || 'שורת תמחור לעריכה'),
        unit: String(evaluation.suggested_unit || 'יח'),
        quantity,
        unit_price_excl_vat: draftUnitPrice,
        amount_excl_vat: normalizePositiveMoney(quantity * draftUnitPrice, 0),
        basis: 'שורה אוטומטית שנוצרה מהערכת המחיר עד לפירוט מלא.',
        is_inference: evaluation.source === 'CUSTOM_ANALYSIS',
    }];
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
    zeroMatchWithDraftPrice: 'לא נמצא סעיף מחיר ישיר בכתב הכמויות או במחירונים המחייבים, ולכן נבנתה טיוטת תמחור לעריכה לפי מסמכי הפרויקט, המפרטים וההקשר הביצועי. יש לבדוק רק פרטים שמשנים מהותית את הסכום.',
    zeroMatchWithoutDraftPrice: 'לא נמצא סעיף מחיר ישיר בכתב הכמויות או במחירונים המחייבים, וגם לא ניתן היה לבנות טיוטת תמחור אמינה מהחומר הקיים. נדרשים רק הנתונים שחסרים לחישוב הסכום.',
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
    evaluation.suggested_unit_price_excl_vat = normalizePositiveMoney(evaluation.suggested_unit_price_excl_vat, 0);
    evaluation.suggested_quantity = normalizePositiveQuantity(evaluation.suggested_quantity, 1);
    evaluation.needed_documents = normalizeNonEmptyStrings(evaluation.needed_documents, 4);
    evaluation.source_basis = normalizeNonEmptyStrings(evaluation.source_basis, 6);
    evaluation.document_precedence_assessment = String(evaluation.document_precedence_assessment || '').trim();
    evaluation.questions = filterPricingQuestions(evaluation.questions, 3);
    evaluation.ancillary_notes = normalizeNonEmptyStrings(evaluation.ancillary_notes, 4);
    evaluation.pricing_breakdown = normalizePricingBreakdown(evaluation.pricing_breakdown, evaluation);
    evaluation.quantity_basis = normalizeEnumValue(
        evaluation.quantity_basis,
        ['EXPLICIT', 'DERIVED', 'ESTIMATED', 'LUMP_SUM'] as const,
        looksLikeLumpSumUnit(evaluation.suggested_unit) ? 'LUMP_SUM' : 'ESTIMATED',
    );
    evaluation.ancillary_scope = normalizeEnumValue(
        evaluation.ancillary_scope,
        ['NONE', 'SUGGEST_ONLY', 'REVIEW_ONLY', 'BLOCKED_AUTO_INCLUDE'] as const,
        'NONE',
    );
    evaluation.quantity_review_required = Boolean(evaluation.quantity_review_required);
    evaluation.requires_user_answer_before_approval = Boolean(evaluation.requires_user_answer_before_approval);

    if (evaluation.quantity_basis === 'LUMP_SUM') {
        evaluation.suggested_quantity = 1;
    }

    if (evaluation.quantity_basis === 'ESTIMATED' && !looksLikeLumpSumUnit(evaluation.suggested_unit)) {
        evaluation.quantity_review_required = true;
    }

    if (
        evaluation.suggested_quantity === 1 &&
        !looksLikeLumpSumUnit(evaluation.suggested_unit) &&
        evaluation.quantity_basis !== 'EXPLICIT' &&
        evaluation.quantity_basis !== 'DERIVED'
    ) {
        evaluation.quantity_review_required = true;
        evaluation.quantity_basis = 'ESTIMATED';
    }

    if (!context.hasSourceMatches) {
        const draftPrice = normalizePositiveMoney(evaluation.suggested_unit_price_excl_vat, 0);
        const hasDraftPrice = draftPrice > 0;

        evaluation.match_found = false;
        evaluation.source = 'CUSTOM_ANALYSIS';
        evaluation.item_code = evaluation.item_code || 'NEW';
        evaluation.match_quality = 'ZERO_MATCH';
        const currentConfidence = typeof evaluation.confidence === 'number' ? evaluation.confidence : (hasDraftPrice ? 0.42 : 0.3);
        evaluation.confidence = hasDraftPrice
            ? Math.min(Math.max(currentConfidence, 0.25), 0.6)
            : Math.min(Math.max(currentConfidence, 0.15), 0.45);
        evaluation.suggested_unit_price_excl_vat = draftPrice;
        evaluation.zero_match_reason = evaluation.zero_match_reason || (
            hasDraftPrice
                ? context.textFallbacks.zeroMatchWithDraftPrice
                : context.textFallbacks.zeroMatchWithoutDraftPrice
        );
        const neededDocuments = Array.isArray(evaluation.needed_documents) ? evaluation.needed_documents : [];
        const currentQuestions = Array.isArray(evaluation.questions) ? evaluation.questions : [];

        evaluation.needed_documents = neededDocuments.length ? neededDocuments : [];
        evaluation.questions = currentQuestions.length
            ? currentQuestions
            : (hasDraftPrice ? [] : context.textFallbacks.zeroMatchQuestions);
    }

    const questions = Array.isArray(evaluation.questions) ? evaluation.questions : [];

    if (evaluation.quantity_review_required && questions.length === 0) {
        evaluation.questions = [context.textFallbacks.quantityReviewQuestion];
    }

    const nextQuestions = Array.isArray(evaluation.questions) ? evaluation.questions : [];
    if (evaluation.quantity_review_required && nextQuestions.length > 0) {
        evaluation.requires_user_answer_before_approval = true;
    }

    return evaluation;
}
