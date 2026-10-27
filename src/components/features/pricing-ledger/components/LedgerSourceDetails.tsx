"use client";
import { BidiText } from '@/components/ui/titanium/BidiText';
import { Button } from '@/components/ui/titanium/Button';
import { Feedback } from '@/components/ui/titanium/Feedback';
import type { PricingLedgerItem } from '../types';
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
function noteText(value: unknown) { if (value === null || value === undefined)
    return ''; if (typeof value === 'object') {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
} return String(value); }
export function LedgerSourceDetails({ item, onOpenSource }: {
    item: PricingLedgerItem;
    onOpenSource(documentId: string, page: number | null): void;
}) {
    const evidence = record(item.evidence_data), pair = record(evidence.document_pair), notes = Array.isArray(item.governing_notes) ? item.governing_notes.map(noteText) : item.governing_notes ? [noteText(item.governing_notes)] : [];
    const links = [{ id: item.source_execution_doc_id || text(pair.work_doc_id), title: item.source_execution_doc || text(evidence.work_title) || 'מסמך ביצוע', page: typeof evidence.work_page === 'number' ? evidence.work_page : null }, { id: text(pair.contract_doc_id), title: text(evidence.contract_title) || 'מסמך חוזי', page: typeof evidence.contract_page === 'number' ? evidence.contract_page : null }].filter(link => link.id);
    return <section className="ti-ledger-source" dir="rtl"><p className="ti-source-name"><BidiText kind="code" value={item.item_code || '—'}/></p><h3 className="ti-section-title">{item.description}</h3><dl className="ti-source-metadata"><div><dt>מקור הרשומה</dt><dd>{item.source === 'BOQ' ? 'כתב הכמויות' : item.source === 'DEKEL' ? 'מחירון דקל' : item.source === 'CONTRACTOR' ? 'מחירון קבלן' : item.source === 'CUSTOM_ANALYSIS' ? 'ניתוח מחיר / רישום ידני' : item.source || 'לא צוין'}</dd></div><div><dt>מסמך מקור שמור</dt><dd><BidiText kind="file" value={item.source_execution_doc || 'לא צוין'}/></dd></div></dl>
 {item.ai_rationale ? <div><h4 className="ti-section-title">הסבר שנשמר עם השורה</h4><p className="ti-copy">{item.ai_rationale}</p></div> : <Feedback>לא נשמר הסבר נוסף לשורה הזאת.</Feedback>}
 {notes.length > 0 && <div><h4 className="ti-section-title">הערות והסתמכויות</h4><ul className="ti-ledger-notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
 {[['ציטוט מהבסיס', evidence.contract_quote], ['ציטוט ממסמך הביצוע', evidence.work_quote]].map(([label, quote]) => typeof quote === 'string' && quote ? <div key={String(label)}><h4 className="ti-section-title">{String(label)}</h4><blockquote className="ti-evidence-quote" dir="auto">{quote}</blockquote></div> : null)}
 {links.length ? <div className="ti-actions">{links.map(link => <Button key={link.id} onClick={() => onOpenSource(link.id!, link.page)}>{link.title} · {link.page ? `עמוד ${link.page}` : 'עמוד לא אומת'}</Button>)}</div> : <Feedback>אין מסמך מקור מקושר לפתיחה. שם קובץ או הסבר לבדם אינם מאמתים את המקור.</Feedback>}
 </section>;
}
