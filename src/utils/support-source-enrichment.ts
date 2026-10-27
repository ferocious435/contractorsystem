import { createHash } from 'crypto';

export const SUPPORT_ANALYSIS_VERSION = 'support-impact-v3';

/** Publish checked state, never a model's free-form assertion of entitlement or contract cancellation. */
export function checkedSupportSummary(scope: { status: string; requiresReview: boolean } | null, referenceCount: number) {
    if (scope?.status === 'FULL' && !scope.requiresReview) return {
        impact_summary: 'המקורות מכסים את העבודה. הסכום מבוסס על הכמות והמחיר המאומתים, לפני מע״מ.',
        recommended_action: 'לעיין במקורות ובנתוני החישוב לפני אישור התמחור.',
    };
    if (scope?.status === 'PARTIAL') return {
        impact_summary: 'המחיר מכסה רק חלק מהעבודה. הפעולות החסרות נשארו לבדיקה וללא סכום סופי.',
        recommended_action: 'להשלים מקור ותמחור לפעולות שאינן מכוסות, בלי לשלם שוב על פעולה שכבר כלולה.',
    };
    if (scope?.status === 'REJECTED') return {
        impact_summary: 'הסעיפים שנבדקו לא התאימו לעבודה או לתנאי המקורות. לא אושר סכום.',
        recommended_action: 'לבחור מקור מתאים ולבדוק מחדש את התאמת הסעיף לפני אישור תמחור.',
    };
    return { impact_summary: referenceCount ? 'נמצאו מקורות נוספים להשוואה; הציטוטים מוצגים לבדיקה. לא אושר סכום נוסף.'
        : 'המקורות לא הספיקו לאימות תמחור מלא. הנתונים נשארו לבדיקה.',
        recommended_action: 'לבדוק את המקורות ולהשלים את הנתון או האישור החסר לפני אישור סכום.',
    };
}

export type SupportIncorporationEvidence = {
    document_id: string;
    title: string | null;
    quote: string;
    target_document_id?: string;
    target_title?: string;
    page?: number | null;
};

export type SupportCandidate = {
    id: string;
    text: string;
    title?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
    page?: number | null;
    sectionCode?: string | null;
    itemCode?: string | null;
    unit?: string | null;
    rate?: number | string | null;
    applicability?: 'CONFIRMED' | 'REFERENCE_ONLY' | 'NEEDS_REVIEW';
    applicabilityReason?: string;
    incorporationEvidence?: SupportIncorporationEvidence[];
};

const STOP_WORDS = new Set([
    'אשר', 'הינו', 'הינה', 'הקבלן', 'העבודה', 'עבודה', 'מסמך', 'נדרש', 'נדרשת',
    'צריך', 'לפי', 'עבור', 'במסמך', 'בפרויקט', 'contractor', 'document', 'project',
    'work', 'with', 'from', 'that', 'this', 'the', 'and',
    'אישור', 'הוראות', 'אביזרי', 'אביזרים', 'מוצר', 'מוצרים', 'אספקה', 'התקנה', 'הובלה',
    'הפעלה', 'נדרש', 'הנדרש', 'כולל', 'לביצוע', 'ביצוע', 'תכניות', 'התכניות', 'תוכניות',
    'מפרט', 'המפרט', 'סעיף', 'היצרן', 'לתשלום', 'תשלום', 'supply', 'installation', 'including',
    'לקבל', 'למסור', 'להגיש', 'להעביר', 'בכתב', 'כתב', 'הצגת', 'הסבר', 'דרישה', 'בקשה',
    'בבקשה', 'בלבד', 'לעניין', 'עניין', 'מאושר', 'מאושרים', 'קיים', 'הקיים',
]);

function normalize(value: unknown) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^0-9a-z\u0590-\u05ff]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokens(value: unknown) {
    const result = new Set<string>();
    for (const token of normalize(value).split(' ')) {
        if ((token.length < 4 && !/^[a-z]{3,}$/u.test(token)) || !/\p{L}/u.test(token)) continue;
        const variants = [token];
        let withoutPrefix = token;
        for (let depth = 0; depth < 2 && /^[והבלכמש]/u.test(withoutPrefix) && withoutPrefix.length >= 5; depth += 1) {
            withoutPrefix = withoutPrefix.slice(1);
            variants.push(withoutPrefix);
        }
        if (variants.some((variant) => STOP_WORDS.has(variant))) continue;
        variants.forEach((variant) => result.add(variant));
    }
    return result;
}

export function extractSupportSearchTerms(value: unknown, limit = 8) {
    return [...tokens(value)]
        .filter((token) => !/^\d{1,3}$/.test(token))
        .sort((left, right) => right.length - left.length || left.localeCompare(right))
        .slice(0, limit);
}

export function buildSafeIlikeOrFilter(column: string, terms: string[]) {
    const safeColumn = /^[a-z_][a-z0-9_]*$/i.test(column) ? column : 'text';
    return terms
        .map((term) => normalize(term).replace(/[,().%_*]/g, '').trim())
        .filter((term) => term.length >= 4 || /^[a-z]{3,}$/u.test(term))
        .slice(0, 8)
        .map((term) => `${safeColumn}.ilike.%${term}%`)
        .join(',');
}

export function rankSupportCandidates<T extends SupportCandidate>(
    query: unknown,
    candidates: T[],
    limit = 4,
) {
    const queryWords = normalize(query).split(' ')
        .map((word) => tokens(word)).filter((variants) => variants.size > 0);
    return candidates
        .map((candidate, order) => {
            const candidateTokens = tokens(candidate.text);
            const matchedWords = queryWords.filter((variants) => [...variants].some((token) => candidateTokens.has(token)));
            const hasExactItemCode = Boolean(candidate.itemCode && String(query).includes(candidate.itemCode));
            let score = 0;
            const distinctMatches = new Set(matchedWords.map((variants) => [...variants].find((token) => candidateTokens.has(token))));
            if (hasExactItemCode || distinctMatches.size >= Math.min(2, queryWords.length)) {
                for (const token of distinctMatches) score += Math.min(10, token?.length || 0);
                if (hasExactItemCode) score += 30;
            }
            return { candidate, score, order };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.order - right.order)
        .slice(0, limit)
        .map((item) => item.candidate);
}

export function supportSourceSignature(parts: unknown[]) {
    const stable = parts
        .map((part) => JSON.stringify(part))
        .sort()
        .join('\n');
    return createHash('sha256').update(stable).digest('hex');
}

export const SUPPORT_ANALYSIS_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['impact_summary', 'recommended_action', 'reference_ids', 'price_item_ids'],
    properties: {
        impact_summary: { type: 'string', maxLength: 500 },
        recommended_action: { type: 'string', maxLength: 500 },
        reference_ids: {
            type: 'array',
            maxItems: 2,
            items: { type: 'string', pattern: '^R[1-9][0-9]*$' },
        },
        price_item_ids: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', pattern: '^P[1-9][0-9]*$' },
        },
    },
} as const;

function formatReferenceCandidates(candidates: SupportCandidate[]) {
    if (candidates.length === 0) return 'No relevant reference excerpt was found.';
    return candidates.map((candidate, index) => [
        `R${index + 1}`,
        `Source: ${candidate.title || candidate.sourceType || 'reference'}`,
        `Applicability: ${candidate.applicability || 'REFERENCE_ONLY'}`,
        candidate.page ? `Page: ${candidate.page}` : '',
        candidate.sectionCode ? `Section: ${candidate.sectionCode}` : '',
        `Exact excerpt: ${candidate.text}`,
    ].filter(Boolean).join('\n')).join('\n\n');
}

function formatPriceCandidates(candidates: SupportCandidate[]) {
    if (candidates.length === 0) return 'No relevant price-list item was found.';
    return candidates.map((candidate, index) => [
        `P${index + 1}`,
        `Price list: ${candidate.title || 'price list'}`,
        candidate.itemCode ? `Item: ${candidate.itemCode}` : '',
        `Description: ${candidate.text}`,
        candidate.unit ? `Unit: ${candidate.unit}` : '',
        candidate.rate !== null && candidate.rate !== undefined ? `Rate before VAT: ${candidate.rate}` : '',
    ].filter(Boolean).join('\n')).join('\n\n');
}

export function buildSupportAnalysisPrompt(params: {
    title: string;
    category: string;
    contractQuote: string;
    workQuote: string;
    referenceCandidates: SupportCandidate[];
    priceCandidates: SupportCandidate[];
}) {
    return `
You review the practical effect of one already detected issue in an Israeli construction project.
The issue itself was found in project documents. Use the optional reference and price candidates only to explain impact and the next contractor action.
Return one valid JSON object. All user-facing text must be short, plain Hebrew.

ISSUE
Title: ${params.title}
Category: ${params.category}
Project-contract quote: ${params.contractQuote || 'None'}
Work-document quote: ${params.workQuote || 'None'}

REFERENCE CANDIDATES
${formatReferenceCandidates(params.referenceCandidates)}

PRICE CANDIDATES
${formatPriceCandidates(params.priceCandidates)}

RULES
1. Select only candidate IDs that directly relate to this issue.
2. A REFERENCE_ONLY source is context, not proof that it binds this project. Do not call it binding.
3. A CONFIRMED source may support the recommendation, but do not invent a clause or obligation.
4. Price priority is: project BOQ first, then an applicable official price list. A price-list item estimates cost; it does not by itself prove payment entitlement.
5. Do not invent quantities, prices, dates, delay, liability, approval, or financial loss.
6. If no candidate is useful, return empty ID arrays and explain the immediate documentation step from the two project quotes.
7. Keep impact_summary and recommended_action practical and unambiguous.

Return exactly:
{
  "impact_summary": "short practical impact",
  "recommended_action": "one concrete next action",
  "reference_ids": ["R1"],
  "price_item_ids": ["P1"]
}`;
}

export function selectVerifiedSupportIds(
    value: unknown,
    prefix: 'R' | 'P',
    candidateCount: number,
) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item) => new RegExp(`^${prefix}[1-9][0-9]*$`).test(item))
        .filter((item) => {
            const index = Number(item.slice(1));
            return index >= 1 && index <= candidateCount;
        }))];
}

export function selectRelevantSupportIds(params: {
    value: unknown;
    prefix: 'R' | 'P';
    candidates: SupportCandidate[];
    query: string;
}) {
    const { value, prefix, candidates, query } = params;
    return selectVerifiedSupportIds(value, prefix, candidates.length).filter((id) => {
        const candidate = candidates[Number(id.slice(1)) - 1];
        return Boolean(candidate && rankSupportCandidates(query, [candidate], 1).length > 0);
    });
}

function numericTokens(value: string) {
    return new Set(value.match(/\d+(?:[.,]\d+)?/g) || []);
}

export function supportAnalysisTextIsGrounded(params: {
    impactSummary: string;
    recommendedAction: string;
    suppliedSourceText: string;
    selectedReferences: SupportCandidate[];
}) {
    const outputText = `${params.impactSummary}\n${params.recommendedAction}`;
    const sourceNumbers = numericTokens(params.suppliedSourceText);
    const unsupportedNumber = [...numericTokens(outputText)].some((value) => !sourceNumbers.has(value));
    if (unsupportedNumber) return false;

    const onlyUnconfirmedReferences = params.selectedReferences.length > 0
        && params.selectedReferences.every((candidate) => candidate.applicability !== 'CONFIRMED');
    const claimsBindingReference = /המקור\s+מחייב|הספר\s+מחייב|החוזה\s+מחייב|חובה\s+לפי\s+המקור/iu.test(outputText);
    if (onlyUnconfirmedReferences && claimsBindingReference) return false;

    for (const sentence of [params.impactSummary, params.recommendedAction]) {
        const words = normalize(sentence).split(' ').filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
        const counts = new Map<string, number>();
        for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
        if ([...counts.values()].some((count) => count >= 3 && count / words.length > 0.25)) return false;
    }

    return params.impactSummary.trim().length >= 4 && params.recommendedAction.trim().length >= 4;
}
