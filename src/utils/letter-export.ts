import { VAT_RATE } from './constants';
import { getAmountVat, getLedgerRowAmount, isTrustedBaseContractRow } from './project-financials';
import { getIndividualPricing, individualPricingReasonLabels, type IndividualPricingInput } from './individual-pricing';
import { stableLetterValue } from './letter-snapshot';

type CsvInput = IndividualPricingInput & { source?: string | null; item_code?: unknown; description?: unknown; unit?: unknown };
type Money = { net: number; vat: number; gross: number };
function finite(value: unknown): number | null {
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
    const result = Number(value); return Number.isFinite(result) ? result : null;
}
const amount = (value: number | null): string => value === null ? '' : (value || 0).toFixed(2);
function escapeCell(value: unknown): string {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function addMoney(total: Money, value: Money): boolean {
    const keys = ['net', 'vat', 'gross'] as const;
    if (keys.some(key => !Number.isSafeInteger(Math.round(value[key] * 100))
        || !Number.isSafeInteger(Math.round(total[key] * 100) + Math.round(value[key] * 100)))) return false;
    for (const key of keys) total[key] = (Math.round(total[key] * 100) + Math.round(value[key] * 100)) / 100 || 0;
    return true;
}

/** Current project ledger export. Base contract and individually rounded VO work have distinct scopes. */
export function buildLedgerCsv(rows: readonly IndividualPricingInput[], savedProjectBudget?: number | null): string {
    const lines: unknown[][] = [['סוג', 'סעיף', 'תיאור', 'יחידה', 'כמות', 'מחיר יחידה ללא מע״מ', 'סה״כ ללא מע״מ', 'מע״מ', 'סה״כ כולל מע״מ', 'מצב ומקור']];
    const unique = new Map<string, CsvInput>(), conflicts = new Set<string>();
    let duplicates = 0, excluded = 0, incomplete = 0, baseCount = 0, baseNet = 0, ready = 0;
    for (const [index, input] of rows.entries()) {
        const row = input as CsvInput, key = row.id || 'missing-id-' + index;
        if (unique.has(key)) { duplicates++; if (stableLetterValue(unique.get(key)) !== stableLetterValue(row)) conflicts.add(key); }
        else unique.set(key, row);
    }
    const findings = new Map<string, number>();
    for (const row of unique.values()) if (row.type !== 'BASE_CONTRACT' && row.contradiction_id) {
        findings.set(row.contradiction_id, (findings.get(row.contradiction_id) || 0) + 1);
    }
    const vo: Money = { net: 0, vat: 0, gross: 0 };
    for (const [key, row] of unique) {
        const quantity = finite(row.quantity), price = finite(row.unit_price_excl_vat);
        let status = '', money: Money | null = null;
        const base = row.type === 'BASE_CONTRACT';
        const type = base ? 'חוזה בסיס' : row.type === 'PENDING_VO' ? 'חריג לבדיקה'
            : row.type === 'APPROVED_VO' ? 'חריג מאושר' : row.type === 'SENT_VO' ? 'סומן כנשלח' : String(row.type || 'לא ידוע');
        if (!row.id || conflicts.has(key) || (row.contradiction_id && findings.get(row.contradiction_id)! > 1)) {
            status = conflicts.has(key) || row.contradiction_id ? 'חלופות או עותקים סותרים — דורש בדיקה' : 'חסר מזהה — דורש בדיקה'; incomplete++;
        } else if (base) {
            const traced = isTrustedBaseContractRow({ type: row.type, source: row.source, evidence_data: row.evidence_data as Record<string, unknown> });
            if (!traced) { status = 'לא נכלל: חסר מקור חוזה מקושר'; excluded++; }
            else if (quantity === null || quantity < 0 || price === null) { status = 'דורש בדיקה: נתוני חוזה חסרים'; incomplete++; }
            else {
                const net = getLedgerRowAmount({ type: row.type, source: row.source, quantity, unit_price_excl_vat: price,
                    evidence_data: row.evidence_data });
                if (!Number.isSafeInteger(Math.round(net * 100)) || !Number.isSafeInteger(Math.round(baseNet * 100) + Math.round(net * 100))) {
                    status = 'דורש בדיקה: סכום אינו ניתן לייצוג בטוח'; incomplete++;
                } else { baseNet = (Math.round(baseNet * 100) + Math.round(net * 100)) / 100; baseCount++; money = { net, vat: 0, gross: 0 };
                    status = 'מקור BOQ שמור; המע״מ בסיכום חוזה הבסיס'; }
            }
        } else if (!['PENDING_VO', 'APPROVED_VO', 'SENT_VO'].includes(String(row.type))) { status = 'לא נכלל: סוג שורה אינו מוכר'; excluded++; }
        else {
            const value = getIndividualPricing(row);
            if (value.status !== 'complete' || value.totalExclVat === null || value.vatAmount === null || value.totalInclVat === null) {
                status = 'דורש בדיקה: ' + value.reasons.map(reason => individualPricingReasonLabels[reason]).join('; '); incomplete++;
            } else {
                money = { net: value.totalExclVat, vat: value.vatAmount, gross: value.totalInclVat };
                if (!addMoney(vo, money)) { money = null; status = 'דורש בדיקה: סכום אינו ניתן לייצוג בטוח'; incomplete++; }
                else { ready++; status = value.conditionNote; }
            }
        }
        lines.push([type, row.item_code, row.description, row.unit, quantity ?? '', price === null ? '' : amount(price),
            amount(money?.net ?? null), base ? '' : amount(money?.vat ?? null), base ? '' : amount(money?.gross ?? null), status]);
    }
    let baseTotal: Money | null = baseCount ? {net: baseNet, vat: getAmountVat(baseNet, VAT_RATE), gross: 0} : null;
    const budget = finite(savedProjectBudget);
    if (!baseTotal && budget !== null && budget > 0 && Number.isSafeInteger(Math.round(budget * 100))) {
        baseTotal = {net: Math.round(budget * 100) / 100, vat: getAmountVat(budget, VAT_RATE), gross: 0};
    }
    if (baseTotal) {
        baseTotal.gross = (Math.round(baseTotal.net * 100) + Math.round(baseTotal.vat * 100)) / 100;
        if (!Number.isSafeInteger(Math.round(baseTotal.gross * 100))) baseTotal = null;
    }
    const combined: Money = {net: 0, vat: 0, gross: 0};
    const combinedValid = (!baseTotal || addMoney(combined, baseTotal)) && (!ready || addMoney(combined, vo)) && Boolean(baseTotal || ready);
    const summary = (label: string, value: Money | null, note: string) => lines.push([label, '', '', '', '', '', amount(value?.net ?? null), amount(value?.vat ?? null), amount(value?.gross ?? null), note]);
    lines.push([]);
    summary('סיכום חוזה בסיס', baseTotal, baseCount ? 'מקור: שורות BOQ שמורות; מע״מ על סכום החוזה' : baseTotal ? 'מקור: תקציב ידני שמור בפרויקט' : 'אין סכום חוזה מאומת בנתונים שנקראו');
    summary('סיכום תמחורי חריגים מלאים', ready ? vo : null, 'סכום התוצאות האישיות המעוגלות; ' + ready + ' תמחורים מלאים');
    summary('סך הסכומים הידועים שנכללו', combinedValid ? combined : null, 'תחומי החוזה והחריגים מוצגים בנפרד; שורות חסרות אינן אפס');
    lines.push(['דורש בדיקה', incomplete, 'לא נכלל', excluded, 'עותקים שלא נספרו פעמיים', duplicates]);
    return lines.map(line => line.map(escapeCell).join(',')).join('\r\n');
}
