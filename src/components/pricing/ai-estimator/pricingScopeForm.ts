import type { AIEstimatorFormState, AIPricingEvaluationResponse } from './types';
import { assessPricingScopeApproval, type ManualPricingInputs } from '@/utils/pricing-scope-approval';
import { getAmountVat, getLedgerRowAmount, getMoneySum } from '@/utils/project-financials';
import { VAT_RATE } from '@/utils/constants';

const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function toPricingScopeForm(data: AIPricingEvaluationResponse): AIEstimatorFormState {
    return { description: data.suggested_description || '', unit: data.suggested_unit || '',
        quantity: number(data.suggested_quantity), unitPrice: number(data.suggested_unit_price_excl_vat),
        markup: 0, source: data.source || 'CUSTOM_ANALYSIS', manualPricingInputs: {} };
}

export function applyPricingScopeFormEdit(form: AIEstimatorFormState, name: string, raw: string | number): AIEstimatorFormState {
    if (['description', 'unit', 'source'].includes(name)) return { ...form, [name]: String(raw) };
    const fields: Record<string, keyof ManualPricingInputs> = { quantity: 'quantity', unitPrice: 'unitPriceExclVat', markup: 'markupPercent' };
    if (!fields[name]) return form;
    const value = raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;
    return { ...form, [name]: name === 'markup' ? value ?? 0 : value,
        source: name === 'unitPrice' || (name === 'markup' && value !== 0) ? 'CUSTOM_ANALYSIS' : form.source,
        manualPricingInputs: { ...form.manualPricingInputs, [fields[name]]: value ?? (name === 'markup' ? 0 : undefined) } };
}

export function getPricingFormAmounts(form: AIEstimatorFormState) {
    const effectiveUnitPriceExclVat = form.unitPrice === null ? null
        : getLedgerRowAmount({ quantity: 1, unit_price_excl_vat: form.unitPrice * (1 + form.markup / 100) });
    const totalExclVat = form.quantity === null || effectiveUnitPriceExclVat === null ? null
        : getLedgerRowAmount({ quantity: form.quantity, unit_price_excl_vat: effectiveUnitPriceExclVat });
    const vatAmount = totalExclVat === null ? null : getAmountVat(totalExclVat, VAT_RATE);
    return { effectiveUnitPriceExclVat, totalExclVat, vatAmount,
        totalInclVat: totalExclVat === null || vatAmount === null ? null : getMoneySum([totalExclVat, vatAmount]) };
}

export function formatPricingAmount(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';
}

export function getPricingFormApproval(data: AIPricingEvaluationResponse | null, form: AIEstimatorFormState,
    runtime: { isLoading?: boolean; error?: string | null } = {}): { allowed: boolean; reason: string | null } {
    if (runtime.isLoading || runtime.error) return { allowed: false, reason: runtime.error || 'בדיקת המחיר עדיין לא הסתיימה.' };
    if (!data?.scope_review) return { allowed: false, reason: 'טרם התקבלה בדיקת מקור והתאמה למחיר.' };
    if (data.suggested_unit && form.unit !== data.suggested_unit) return { allowed: false, reason: 'יחידת המדידה שונה מהמקור המאומת.' };
    return assessPricingScopeApproval(data.scope_review, form.manualPricingInputs);
}

export function getReviewedPricingFormAmounts(data: AIPricingEvaluationResponse | null, form: AIEstimatorFormState,
    runtime: { isLoading?: boolean; error?: string | null } = {}) {
    const amounts = getPricingFormAmounts(form);
    return getPricingFormApproval(data, form, runtime).allowed ? amounts
        : { ...amounts, totalExclVat: null, vatAmount: null, totalInclVat: null };
}
