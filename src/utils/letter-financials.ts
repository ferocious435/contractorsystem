import { getIndividualPricing, type IndividualPricingInput, type IndividualPricingResult } from './individual-pricing';

export interface LetterFinancialItem {
    ledgerItemId: string;
    quantity: number;
    unitPriceExclVat: number;
    net: number;
    vatRate: number;
    vat: number;
    gross: number;
    conditionBasis: IndividualPricingResult['conditionBasis'];
    conditionNote: string;
}

export interface LetterFinancialSnapshot {
    calculationVersion: 'letter-individual-v1';
    items: LetterFinancialItem[];
    totals: { net: number; vat: number; gross: number };
}

export type LetterFinancialResult = { ok: true; snapshot: LetterFinancialSnapshot }
    | { ok: false; issues: Array<{ itemId: string; reason: string }> };

// Evidence property order must not make an otherwise identical selection conflict.
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return value;
}

function signature(row: IndividualPricingInput): string {
    return JSON.stringify(canonical({ type: row.type, quantity: row.quantity,
        unitPrice: row.unit_price_excl_vat, savedNet: row.total_price_excl_vat,
        vatRate: row.vat_rate, markup: row.markup_percentage,
        contradictionId: row.contradiction_id, evidence: row.evidence_data }));
}

/** Freeze only complete, unambiguous VO work; never apply adjustments or VAT twice. */
export function prepareLetterFinancialSnapshot(rows: readonly IndividualPricingInput[], options: {includeSentInSummary?: boolean} = {}): LetterFinancialResult {
    const issues: Array<{ itemId: string; reason: string }> = [];
    const unique = new Map<string, IndividualPricingInput>();
    const conflicts = new Set<string>();
    const findings = new Map<string, number>();
    if (rows.length === 0) return { ok: false, issues: [{ itemId: '', reason: 'empty-selection' }] };
    for (const row of rows) {
        if (!row.id?.trim()) { issues.push({ itemId: '', reason: 'id-missing' }); continue; }
        const previous = unique.get(row.id);
        if (previous) {
            if (signature(previous) !== signature(row)) conflicts.add(row.id);
        } else {
            unique.set(row.id, row);
            if (row.contradiction_id) findings.set(row.contradiction_id, (findings.get(row.contradiction_id) || 0) + 1);
        }
    }
    const items: LetterFinancialItem[] = [];
    const cents = { net: 0, vat: 0, gross: 0 };
    for (const [id, row] of unique) {
        if (conflicts.has(id)) { issues.push({ itemId: id, reason: 'duplicate-conflict' }); continue; }
        if (row.contradiction_id && findings.get(row.contradiction_id)! > 1) {
            issues.push({ itemId: id, reason: 'alternative-conflict' }); continue;
        }
        if (row.type !== 'PENDING_VO' && row.type !== 'APPROVED_VO' && !(options.includeSentInSummary && row.type === 'SENT_VO')) {
            issues.push({ itemId: id, reason: 'status-ineligible' }); continue;
        }
        const pricing = getIndividualPricing(row);
        if (pricing.status !== 'complete' || pricing.totalExclVat === null || pricing.vatAmount === null
            || pricing.totalInclVat === null || pricing.quantity === null || pricing.unitPriceExclVat === null
            || pricing.vatRate === null) {
            issues.push(...pricing.reasons.map(reason => ({ itemId: id, reason })));
            continue;
        }
        const money = { net: pricing.totalExclVat || 0, vat: pricing.vatAmount || 0, gross: pricing.totalInclVat || 0 };
        const keys = ['net', 'vat', 'gross'] as const;
        if (keys.some(key => !Number.isSafeInteger(Math.round(money[key] * 100))
            || !Number.isSafeInteger(cents[key] + Math.round(money[key] * 100)))) {
            issues.push({ itemId: id, reason: 'amount-unsafe' }); continue;
        }
        for (const key of keys) cents[key] += Math.round(money[key] * 100);
        items.push({ ledgerItemId: id, quantity: pricing.quantity, unitPriceExclVat: pricing.unitPriceExclVat,
            ...money, vatRate: pricing.vatRate, conditionBasis: pricing.conditionBasis, conditionNote: pricing.conditionNote });
    }
    if (issues.length) return { ok: false, issues };
    return { ok: true, snapshot: { calculationVersion: 'letter-individual-v1', items,
        totals: { net: cents.net / 100 || 0, vat: cents.vat / 100 || 0, gross: cents.gross / 100 || 0 } } };
}
