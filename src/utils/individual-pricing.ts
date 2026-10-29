import {
    getLedgerRowAmount,
    getLedgerRowVatAmount,
    getLedgerRowTotalInclVat,
    getMoneySum,
} from '@/utils/project-financials';
import { VAT_RATE } from '@/utils/constants';

export interface IndividualPricingInput {
    id?: string;
    type?: string | null;
    quantity?: unknown;
    unit_price_excl_vat?: unknown;
    total_price_excl_vat?: unknown;
    vat_rate?: unknown;
    markup_percentage?: unknown;
    contradiction_id?: string | null;
    evidence_data?: unknown;
}

export type IndividualPricingReason = 'quantity-unknown' | 'price-unknown' | 'vat-invalid'
    | 'amount-mismatch' | 'amount-invalid' | 'conditions-unconfirmed' | 'source-needs-review';

export const individualPricingReasonLabels: Record<IndividualPricingReason, string> = {
    'quantity-unknown': 'נדרשת כמות תקינה לתמחור',
    'price-unknown': 'חסר מחיר יחידה שמור',
    'vat-invalid': 'שיעור המע״מ חסר או אינו תקין',
    'amount-mismatch': 'הסכום השמור אינו תואם לכמות ולמחיר היחידה',
    'amount-invalid': 'לא ניתן לחשב סכום כספי תקין מהנתונים השמורים',
    'conditions-unconfirmed': 'טרם אושר שכל ההנחות והתוספות נכללות במחיר',
    'source-needs-review': 'נותרו תנאי מקור או שאלות שדורשים בדיקה',
};

export interface IndividualPricingResult {
    status: 'complete' | 'needs-review';
    quantity: number | null;
    unitPriceExclVat: number | null;
    totalExclVat: number | null;
    vatRate: number | null;
    vatAmount: number | null;
    totalInclVat: number | null;
    reasons: IndividualPricingReason[];
    conditionBasis: 'manual' | 'source' | 'confirmed-zero' | 'unconfirmed';
    conditionNote: string;
    adjustments: Array<{ label: string; value: number; note: string }>;
}

export interface IndividualPricingBucket {
    count: number;
    totalInclVat: number | null;
}

export interface IndividualPricingSummary {
    totalInclVat: number | null;
    readyCount: number;
    incompleteCount: number;
    excludedBaseCount: number;
    duplicateCount: number;
    alternativeCount: number;
    byStatus: Record<'pending' | 'approved' | 'sent', IndividualPricingBucket>;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function number(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const round = (value: number) => Math.round(value * 100) / 100 || 0;
const same = (value: unknown, expected: number | null) => expected !== null && number(value) !== null
    && Math.abs(number(value)! - expected) < .000001;
const sameMoney = (value: unknown, expected: number | null) => expected !== null && number(value) !== null
    && round(number(value)!) === round(expected);

/** Mirrors the existing manual-save contract without changing or writing the entered record. */
export function getIndividualPricingDraft<T extends IndividualPricingInput>(item: T) {
    const price = number(item.unit_price_excl_vat);
    return { ...item, unit_price_excl_vat: price === null ? undefined : round(price),
        total_price_excl_vat: undefined, vat_rate: VAT_RATE };
}

/** Records that the entered net price already includes its applicable adjustments. It does not reprice it. */
export function confirmIndividualPricingTerms(item: IndividualPricingInput, note: string): Record<string, unknown> {
    const previous = Array.isArray(item.evidence_data)
        ? { original_evidence_data: item.evidence_data } : record(item.evidence_data);
    return {
        ...previous,
        individual_pricing_terms: {
            version: 'individual-pricing-v1', basis: 'MANUAL', includes_adjustments: true,
            quantity: number(item.quantity), unit_price_excl_vat: number(item.unit_price_excl_vat),
            vat_rate: number(item.vat_rate), note: note.trim(),
        },
    };
}

export function getIndividualPricing(item: IndividualPricingInput): IndividualPricingResult {
    const quantity = number(item.quantity), price = number(item.unit_price_excl_vat), rate = number(item.vat_rate);
    const savedTotal = number(item.total_price_excl_vat), evidence = record(item.evidence_data);
    const evaluation = record(evidence.pricing_evaluation), scope = record(evaluation.scope_review);
    const approval = record(evidence.pricing_approval), manual = record(evidence.individual_pricing_terms);
    const reasons: IndividualPricingReason[] = [];
    if (quantity === null || quantity <= 0) reasons.push('quantity-unknown');
    if (price === null) reasons.push('price-unknown');
    if (rate === null || rate < 0 || rate > 1) reasons.push('vat-invalid');

    let net = quantity !== null && quantity > 0 && price !== null
        ? getLedgerRowAmount({ quantity, unit_price_excl_vat: price }) : null;
    if (net !== null && !Number.isFinite(net)) { reasons.push('amount-invalid'); net = null; }
    if (net !== null && savedTotal !== null && round(savedTotal) !== net) {
        reasons.push('amount-mismatch');
        net = null;
    }

    const manualConfirmed = manual.version === 'individual-pricing-v1' && manual.basis === 'MANUAL'
        && manual.includes_adjustments === true && same(manual.quantity, quantity)
        && same(manual.unit_price_excl_vat, price) && same(manual.vat_rate, rate);
    const sourceConfirmed = scope.version === 'price-scope-v1' && scope.status === 'FULL'
        && scope.requiresReview === false && Array.isArray(scope.issues) && scope.issues.length === 0
        && Array.isArray(scope.uncoveredRequirementIds) && scope.uncoveredRequirementIds.length === 0
        && list(scope.lines).length > 0 && same(approval.quantity, quantity)
        && sameMoney(approval.effective_unit_price_excl_vat, price) && sameMoney(approval.total_excl_vat, net);
    const confirmedZero = net === 0 && price === 0 && text(evidence.zero_value_reason) !== '';
    const sourceBlocked = evaluation.requires_user_answer_before_approval === true
        || (scope.version === 'price-scope-v1' && (scope.status !== 'FULL' || scope.requiresReview !== false
            || !Array.isArray(scope.issues) || scope.issues.length > 0
            || !Array.isArray(scope.uncoveredRequirementIds) || scope.uncoveredRequirementIds.length > 0
            || !Array.isArray(scope.lines) || scope.lines.length === 0));
    if (sourceBlocked) reasons.push('source-needs-review');
    if (!manualConfirmed && !sourceConfirmed && !confirmedZero) reasons.push('conditions-unconfirmed');

    const basis = manualConfirmed ? 'manual' : sourceConfirmed ? 'source' : confirmedZero ? 'confirmed-zero' : 'unconfirmed';
    const conditionNote = basis === 'manual' ? text(manual.note) || 'אושר ידנית: ההנחות והתוספות כבר נכללות במחיר היחידה'
        : basis === 'source' ? 'המחיר לאחר ההתאמות שנכללו בבדיקת המקור השמורה'
            : basis === 'confirmed-zero' ? text(evidence.zero_value_reason)
                : 'לא נשמר אישור מלא לתנאי המחיר; אין להסיק שחלה הנחה בשיעור אפס';
    const adjustments: IndividualPricingResult['adjustments'] = [];
    if (sourceConfirmed) {
        for (const line of list(scope.lines)) for (const value of list(record(line).coefficients)) {
            const coefficient = record(value), amount = number(coefficient.value);
            if (amount !== null) adjustments.push({ label: 'מקדם מהמקור שכבר נכלל במחיר', value: amount,
                note: text(record(list(coefficient.evidence)[0]).quote) });
        }
    }
    const markup = number(item.markup_percentage);
    if ((manualConfirmed || sourceConfirmed) && markup !== null && markup !== 0) {
        adjustments.push({ label: 'התאמה שמורה שכבר נכללת במחיר (%)', value: markup * 100,
            note: 'ההתאמה מוצגת להסבר בלבד ואינה מופעלת שוב' });
    }
    let complete = reasons.length === 0 && net !== null && rate !== null;
    const financialRow = { quantity: 1, unit_price_excl_vat: net, vat_rate: rate };
    let vatAmount = complete ? round(getLedgerRowVatAmount(financialRow)) : null;
    let totalInclVat = complete ? round(getLedgerRowTotalInclVat(financialRow)) : null;
    if (complete && (!Number.isFinite(vatAmount) || !Number.isFinite(totalInclVat))) {
        reasons.push('amount-invalid'); complete = false; vatAmount = null; totalInclVat = null;
    }
    return {
        status: complete ? 'complete' : 'needs-review', quantity, unitPriceExclVat: price, totalExclVat: net,
        vatRate: rate !== null && rate >= 0 && rate <= 1 ? rate : null,
        vatAmount, totalInclVat,
        reasons, conditionBasis: basis, conditionNote, adjustments,
    };
}

const moneyFormatter = new Intl.NumberFormat('he-IL', {
    style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatIndividualMoney(value: number | null): string {
    return value !== null && Number.isFinite(value) ? moneyFormatter.format(value || 0) : '—';
}

export function summarizeIndividualPricing(items: readonly IndividualPricingInput[]): IndividualPricingSummary {
    const result: IndividualPricingSummary = {
        totalInclVat: null, readyCount: 0, incompleteCount: 0, excludedBaseCount: 0,
        duplicateCount: 0, alternativeCount: 0,
        byStatus: { pending: { count: 0, totalInclVat: null }, approved: { count: 0, totalInclVat: null },
            sent: { count: 0, totalInclVat: null } },
    };
    const unique = new Map<string, { item: IndividualPricingInput; pricing: IndividualPricingResult }>();
    const conflictingIds = new Set<string>();
    const signature = (entry: { item: IndividualPricingInput; pricing: IndividualPricingResult }) => JSON.stringify([
        entry.item.type, entry.item.contradiction_id, number(entry.item.quantity), number(entry.item.unit_price_excl_vat),
        number(entry.item.total_price_excl_vat), number(entry.item.vat_rate), entry.pricing.status, entry.pricing.totalInclVat,
    ]);
    for (const item of items) {
        if (item.type === 'BASE_CONTRACT') { result.excludedBaseCount++; continue; }
        if (!item.id) { result.incompleteCount++; continue; }
        const entry = { item, pricing: getIndividualPricing(item) }, previous = unique.get(item.id);
        if (previous) {
            result.duplicateCount++;
            if (signature(previous) !== signature(entry)) conflictingIds.add(item.id);
        } else unique.set(item.id, entry);
    }
    const findingCounts = new Map<string, number>();
    for (const { item } of unique.values()) if (item.contradiction_id) {
        findingCounts.set(item.contradiction_id, (findingCounts.get(item.contradiction_id) || 0) + 1);
    }
    const statuses = { PENDING_VO: 'pending', APPROVED_VO: 'approved', SENT_VO: 'sent' } as const;
    for (const [id, { item, pricing }] of unique) {
        if (conflictingIds.has(id) || (item.contradiction_id && findingCounts.get(item.contradiction_id)! > 1)) {
            result.alternativeCount++; continue;
        }
        const status = statuses[item.type as keyof typeof statuses];
        if (!status || pricing.status !== 'complete' || pricing.totalInclVat === null) { result.incompleteCount++; continue; }
        const bucket = result.byStatus[status];
        bucket.count++;
        bucket.totalInclVat = getMoneySum([bucket.totalInclVat, pricing.totalInclVat]);
        result.readyCount++;
        result.totalInclVat = getMoneySum([result.totalInclVat, pricing.totalInclVat]);
    }
    return result;
}
