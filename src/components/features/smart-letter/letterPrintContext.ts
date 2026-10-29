import type {LetterDraftSnapshot} from '@/utils/letter-draft-types';
import {isLetterDraftSnapshot, isRecord} from '@/utils/letter-snapshot';
import type {SmartLetterLedgerItem} from './types';

export interface LetterPrintContext {
    projectId: string;
    letterId: string;
    mode: 'snapshot' | 'legacy';
    snapshot: LetterDraftSnapshot | null;
    sourceRevisions: Record<string, string>;
    items: SmartLetterLedgerItem[];
    matchesStoredTotals: boolean;
    canPrintText: boolean;
    blockedReason: string | null;
    storedNet: number | null;
    storedVat: number | null;
    storedGross: number | null;
    letterNumber: string | null;
    createdAt: string | null;
    sentMarkedAt: string | null;
    clientDraftId: string | null;
    revision: number | null;
    status: string;
    docType: string;
    content: string;
    subject: string;
    recipientName: string;
}
interface PrintSource { projectId: string; letterId: string; letter: unknown; links: unknown; rows?: unknown; linkedCount?: number | null; }
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown): string => typeof value === 'string' ? value : '';
export function blockedLetterPrintContext(letterId: string, reason: string): LetterPrintContext {
    return {projectId: '', letterId, mode: 'legacy', snapshot: null, sourceRevisions: {}, items: [], matchesStoredTotals: false,
        canPrintText: false, blockedReason: reason, storedNet: null, storedVat: null, storedGross: null,
        letterNumber: null, createdAt: null, sentMarkedAt: null, clientDraftId: null, revision: null,
        status: 'UNKNOWN', docType: 'general', content: '', subject: '', recipientName: ''};
}
/** A historical amount is never reconstructed from mutable current ledger rows. */
export function assessLetterPrintContext({projectId, letterId, letter, links, linkedCount}: PrintSource): LetterPrintContext {
    if (!isRecord(letter) || letter.id !== letterId || letter.project_id !== projectId) {
        return blockedLetterPrintContext(letterId, 'המכתב אינו זמין בפרויקט הזה.');
    }
    const mode = letter.calculation_version === 'letter-individual-v1' ? 'snapshot' : 'legacy';
    const base: LetterPrintContext = {...blockedLetterPrintContext(letterId, ''), projectId, mode,
        storedNet: number(letter.total_amount_excl_vat), storedVat: number(letter.vat_amount), storedGross: number(letter.total_amount_incl_vat),
        letterNumber: text(letter.letter_number) || null, createdAt: text(letter.created_at) || null,
        sentMarkedAt: text(letter.sent_marked_at) || null, clientDraftId: text(letter.client_draft_id) || null,
        revision: number(letter.revision), status: text(letter.status) || 'UNKNOWN', docType: text(letter.doc_type) || 'general',
        content: text(letter.content), subject: text(letter.subject), recipientName: text(letter.recipient_name),
        canPrintText: Boolean(text(letter.content))};
    const blocked = (reason: string): LetterPrintContext => ({...base, blockedReason: reason});
    if (mode === 'legacy') return blocked('רשומה היסטורית: לא נשמר צילום כספי מלא. אפשר להדפיס את הטקסט והסכומים הידועים בלבד; סכום לא ידוע מוצג במפורש.');
    if (!base.clientDraftId || !Number.isSafeInteger(base.revision) || Number(base.revision) < 1 || !['DRAFT', 'SENT'].includes(base.status)) {
        return blocked('לא נקראה גרסה מלאה של המכתב. יש לקרוא אותו שוב לפני עריכה או הדפסה.');
    }
    if (!Array.isArray(links) || !links.length || !Number.isSafeInteger(linkedCount) || links.length !== linkedCount) {
        return blocked('לא אושרה קריאה מלאה של הקישורים למכתב. אין להדפיס צירוף כספי חלקי.');
    }
    const records = links.filter(isRecord).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const ids = records.map(link => link.ledger_item_id);
    if (records.length !== links.length || new Set(ids).size !== links.length
        || records.some((link, index) => link.letter_id !== letterId || link.sort_order !== index || typeof link.ledger_item_id !== 'string'
            || !isRecord(link.pricing_snapshot) || link.pricing_snapshot.ledgerItemId !== link.ledger_item_id
            || !Array.isArray(link.source_snapshot) || typeof link.source_revision !== 'string' || !/^[a-f\d]{64}$/i.test(link.source_revision))) {
        return blocked('צילום השורות או המקורות אינו מלא ואינו חד־משמעי. יש לקרוא את המכתב שוב.');
    }
    const snapshot: unknown = {calculationVersion: letter.calculation_version, items: records.map(link => ({...(link.pricing_snapshot as Record<string, unknown>), sources: link.source_snapshot})),
        totals: {net: base.storedNet, vat: base.storedVat, gross: base.storedGross}};
    if (!isLetterDraftSnapshot(snapshot)) return blocked('הצילום הכספי אינו מלא או שסכומי השורות אינם תואמים לסכומים השמורים.');
    const items: SmartLetterLedgerItem[] = snapshot.items.map(item => ({id: item.ledgerItemId, project_id: projectId,
        description: item.description, item_code: item.itemCode, unit: item.unit, quantity: item.quantity,
        unit_price_excl_vat: item.unitPriceExclVat, total_price_excl_vat: item.net, vat_rate: item.vatRate,
        type: base.status === 'SENT' ? 'SENT_VO' : undefined, governing_notes: item.sources.map(source => source.manualNote || [source.title, source.pageLabel, source.quote].filter(Boolean).join(' · ')).join('\n')}));
    return {...base, snapshot, sourceRevisions: Object.fromEntries(records.map(link => [link.ledger_item_id, link.source_revision])) as Record<string, string>,
        items, matchesStoredTotals: true, blockedReason: null};
}
