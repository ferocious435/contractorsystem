import type { PricingScopeResult } from './pricing-scope-review.ts';
import { getLedgerRowAmount, getMoneySum } from './project-financials.ts';

export type ManualPricingInputs = { quantity?: number; unitPriceExclVat?: number; markupPercent?: number };
export type PricingScopeApproval = { allowed: boolean; reason: string | null; totalExclVat: number | null;
    quantity: number | null; unitPriceExclVat: number | null; effectiveUnitPriceExclVat: number | null; markupPercent: number };

export function assessPricingScopeApproval(review: PricingScopeResult, manual: ManualPricingInputs): PricingScopeApproval {
    const blocked = (reason: string): PricingScopeApproval => ({ allowed: false, reason, totalExclVat: null,
        quantity: null, unitPriceExclVat: null, effectiveUnitPriceExclVat: null, markupPercent: 0 });
    if (!review || review.version !== 'price-scope-v1' || !Array.isArray(review.requirements) || !review.requirements.length
        || !Array.isArray(review.lines) || !review.lines.length || !Array.isArray(review.positions)
        || !Array.isArray(review.uncoveredRequirementIds) || review.uncoveredRequirementIds.length || !Array.isArray(review.issues))
        return blocked('נדרש להשלים התאמה וכיסוי של העבודה לפי המקורות.');
    if (review.issues.some(issue => !issue.startsWith('quantity_unverified:') && !issue.startsWith('price_unverified:')))
        return blocked('נותרו פרטי התאמה או מקדמים שלא אומתו במקורות.');
    if (review.lines.some(line => !review.positions.some(position => position.candidateId === line.candidateId
        && ['FULL', 'PARTIAL'].includes(position.status)) || line.coefficients.some(coefficient => coefficient.value === null)))
        return blocked('המחיר או תנאי העבודה עדיין דורשים בדיקה.');
    if (review.lines.some(line => line.unit !== review.lines[0].unit)) return blocked('יש לבדוק את יחידות וכמויות רכיבי התמחור בנפרד.');
    const quantities = review.lines.map(line => line.quantity.value);
    if (new Set(quantities.filter(value => value !== null)).size > 1) return blocked('רכיבי המחיר כוללים כמויות שונות; נדרשת בדיקה.');
    const quantity = manual.quantity ?? (quantities.every(value => value === quantities[0]) ? quantities[0] : null);
    const rates = review.lines.map(line => line.unitPriceExclVat.value === null ? null
        : getLedgerRowAmount({ quantity: 1, unit_price_excl_vat: line.unitPriceExclVat.value
            * line.coefficients.reduce((factor, coefficient) => factor * coefficient.value!, 1) }));
    const unitPrice = manual.unitPriceExclVat ?? (rates.every(value => value !== null) ? getMoneySum(rates) : null);
    const markup = manual.markupPercent ?? 0;
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) return blocked('יש להזין כמות מאומתת או כמות ידנית מפורשת.');
    if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(markup) || markup <= -100)
        return blocked('יש להזין מחיר יחידה מאומת או מחיר ידני מפורש, ללא מע״מ.');
    const effectiveUnitPriceExclVat = getLedgerRowAmount({ quantity: 1, unit_price_excl_vat: unitPrice * (1 + markup / 100) });
    const totalExclVat = getLedgerRowAmount({ quantity, unit_price_excl_vat: effectiveUnitPriceExclVat });
    if (!Number.isFinite(totalExclVat) || totalExclVat <= 0) return blocked('לא ניתן לחשב סכום תקין מהנתונים.');
    return { allowed: true, reason: null, totalExclVat, quantity, unitPriceExclVat: unitPrice, effectiveUnitPriceExclVat, markupPercent: markup };
}
