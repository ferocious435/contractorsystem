import {VAT_RATE} from '@/utils/constants';
import {getAmountInclVat, getLedgerRowAmount, getMoneySum} from '@/utils/project-financials';
import type {SmartLetterLedgerItem} from './types';

export interface LetterPrintContext {
    letterId: string;
    items: SmartLetterLedgerItem[];
    matchesStoredTotals: boolean;
    blockedReason: string | null;
    storedNet?: number;
    storedGross?: number;
}

interface PrintSource {
    projectId: string;
    letterId: string;
    letter: unknown;
    links: unknown;
    rows: unknown;
    linkedCount?: number | null;
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function blockedLetterPrintContext(letterId: string, reason: string): LetterPrintContext {
    return {letterId, items: [], matchesStoredTotals: false, blockedReason: reason};
}

/** Checks a reconstructed view against stored totals; it does not change the archived letter. */
export function assessLetterPrintContext({projectId, letterId, letter, links, rows, linkedCount}: PrintSource): LetterPrintContext {
    const header = record(letter);
    if (!header || header.id !== letterId || header.project_id !== projectId) {
        return blockedLetterPrintContext(letterId, 'המכתב אינו זמין בפרויקט הזה.');
    }
    const storedNet = number(header.total_amount_excl_vat) ? header.total_amount_excl_vat : undefined;
    const storedGross = number(header.total_amount_incl_vat) ? header.total_amount_incl_vat : undefined;
    const blocked = (reason: string): LetterPrintContext => ({...blockedLetterPrintContext(letterId, reason), storedNet, storedGross});
    if (storedNet === undefined || storedGross === undefined) {
        return blocked('לא נשמרו או לא נקראו כל סכומי המכתב, ובפרט הסכום הכולל מע״מ. אין בסיס לשחזור צירוף כספי מאומת.');
    }
    if (linkedCount !== undefined && (!number(linkedCount) || !Number.isInteger(linkedCount) || !Array.isArray(links) || links.length !== linkedCount)) {
        return blocked('לא אושרה קריאה מלאה של הקישורים למכתב. אין להדפיס צירוף כספי חלקי, גם אם הסכום החלקי נראה תואם.');
    }
    if (!Array.isArray(links) || !links.length || !Array.isArray(rows)) {
        return blocked('לא נקראו כל השורות המקושרות למכתב. אפשר לקרוא את הטקסט השמור, אך אין להדפיס צירוף כספי חלקי.');
    }
    const ids = links.map(link => record(link)?.ledger_item_id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length || rows.length !== ids.length) {
        return blocked('הקישור לשורות הכספיות חסר או אינו חד־משמעי. התצוגה אינה מחליפה אותו באפס.');
    }
    const records = rows.map(record);
    if (records.some(row => !row || !ids.includes(row.id) || row.project_id !== projectId || !['PENDING_VO', 'APPROVED_VO', 'SENT_VO'].includes(String(row.type)) || !number(row.quantity) || !number(row.unit_price_excl_vat)) || new Set(records.map(row => row?.id)).size !== ids.length) {
        return blocked('חסרים נתוני שורה מלאים מאותו פרויקט. נדרשת בדיקת המקור לפני הדפסת הצירוף.');
    }
    const byId = new Map(records.map(row => [row!.id, row!]));
    const items = ids.map(id => byId.get(id) as unknown as SmartLetterLedgerItem);
    const net = getMoneySum(items.map(item => getLedgerRowAmount(item)));
    const gross = getAmountInclVat(net, VAT_RATE);
    if (getMoneySum([net, -storedNet]) !== 0 || getMoneySum([gross, -storedGross]) !== 0) {
        return blocked('הסכומים בשורות הזמינות אינם תואמים לסכומי המכתב השמור. הסכומים השמורים לא שונו; אין להחליף אותם בחישוב חדש.');
    }
    return {letterId, items, matchesStoredTotals: true, blockedReason: null, storedNet, storedGross};
}
