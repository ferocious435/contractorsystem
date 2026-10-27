'use client';

import { useState } from 'react';
import type { IssueReconciliationPlan } from '@/utils/radar-issue-reconciliation';
import { RADAR_FINDINGS_UPDATED_EVENT } from '@/utils/radar-review-disposition';
import { getLedgerRowAmount, type LedgerLikeRow } from '@/utils/project-financials';

type SavedRecord = Record<string, unknown>;
const money = (value: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(value);
const relations = { PRIMARY: 'המקור הראשי', REPEAT: 'אזכור חוזר', ADDITIONAL_BASIS: 'בסיס חוזי נוסף',
    CHANGED_CONDITION: 'תנאי או עמדה נוספים', SOURCE_EVENT: 'אירוע מתועד; ההשוואה החוזית אינה מאומתת' };

export function RadarLinkedRecords({ projectId, findingId, value, openDocument }: {
    projectId: string; findingId: string; value: unknown;
    openDocument: (id: string, page: number | null) => void;
}) {
    const [plan, setPlan] = useState<IssueReconciliationPlan | null>(() => value && typeof value === 'object'
        && (value as IssueReconciliationPlan).version === 'issue-links-v1' ? value as IssueReconciliationPlan : null);
    const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    const [records, setRecords] = useState<{ ledger: SavedRecord[]; letters: SavedRecord[] } | null>(null);
    async function reconcile() {
        setBusy(true); setError(''); setMessage('');
        try {
            const response = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, issueId: findingId, revalidateSavedOnly: true, reconcileSavedOnly: true, apply: true }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('בדיקת הקישורים לא הושלמה. אפשר לנסות שוב.');
            setPlan(result.plans[0] || null); setRecords(null);
            setMessage(result.updated ? 'הרישומים קושרו לנושא. התמחור והמכתבים נשמרו.' : 'הבדיקה הושלמה; לא נדרשו שינויים.');
            window.dispatchEvent(new CustomEvent(RADAR_FINDINGS_UPDATED_EVENT, { detail: { projectId } }));
        } catch (error) { setError(error instanceof Error ? error.message : 'בדיקת הקישורים נכשלה.'); }
        finally { setBusy(false); }
    }
    async function openFinancialRecords() {
        setBusy(true); setError('');
        try {
            const response = await fetch(`/api/radar/linked-records?${new URLSearchParams({ projectId, findingId })}`, { cache: 'no-store' });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error('לא ניתן לפתוח כעת את התמחור והמכתבים השמורים.');
            setRecords({ ledger: result.ledger, letters: result.letters });
        } catch (error) { setError(error instanceof Error ? error.message : 'פתיחת הרישומים נכשלה.'); }
        finally { setBusy(false); }
    }
    const primarySource = plan?.attachHistory.find(entry => entry.relation === 'PRIMARY');
    return <section aria-label="קישורי הנושא ותמחור קיים" className="ti-radar-section">
        <h4 className="text-sm font-bold text-violet-200">רישומים ומסמכים הקשורים לאותו נושא</h4>
        <button type="button" disabled={busy} onClick={() => void reconcile()} className="text-xs text-violet-200 disabled:opacity-50">
            {busy ? 'בודק…' : 'בדיקת כפילויות וקישור לרישומים קיימים'}
        </button>
        {message && <p role="status" className="text-xs text-emerald-200">{message}</p>}
        {error && <p role="alert" className="text-xs text-red-200">{error}</p>}
        {plan?.flagInvalidEvidence.map(problem => <div key={problem.findingId} className="p-3 rounded-xl border border-amber-400/30 space-y-2">
            <p className="text-sm font-bold text-amber-200">קישור מקור שגוי ברישום קודם</p>
            <p className="text-xs text-gray-200">{problem.reason === 'BASELINE_QUOTE_NOT_FOUND'
                ? 'הציטוט החוזי אינו מופיע במקור שאליו קושר הרישום. אירוע העבודה המתועד נשמר בנפרד.'
                : 'הציטוט אינו מופיע במסמך העבודה שאליו קושר הרישום הקודם. התמחור והמכתב נשמרו כפי שנרשמו; קישור זה אינו מוכיח את השינוי או את הסכמת הצדדים.'}</p>
            {(problem.originalSourceId || problem.originalBaselineId) && <button type="button" className="text-xs text-amber-200"
                onClick={() => openDocument((problem.reason === 'BASELINE_QUOTE_NOT_FOUND' ? problem.originalBaselineId : problem.originalSourceId)!, null)}>פתח את המקור שקושר בטעות</button>}
            {primarySource && <button type="button" className="block text-xs text-blue-200"
                onClick={() => openDocument(primarySource.sourceDocumentId, primarySource.anchor.page)}>פתח את המקור המאומת של הנושא</button>}
        </div>)}
        {plan && plan.attachHistory.length > 1 && <details className="text-xs text-gray-300">
            <summary className="cursor-pointer">מקורות ותנאים שנשמרו ({plan.attachHistory.length})</summary>
            <div className="space-y-3 mt-3">{plan.attachHistory.map(entry => <div key={`${entry.findingId}:${entry.anchor.start}`}>
                <p>{relations[entry.relation]} · {entry.sourceDocumentTitle}</p>
                <blockquote className="leading-7">{entry.anchor.quote}</blockquote>
                {entry.baselineAnchor && <blockquote className="leading-7 text-blue-200">{entry.baselineAnchor.quote}</blockquote>}
                <button type="button" onClick={() => openDocument(entry.sourceDocumentId, entry.anchor.page)}>פתח מסמך מקור</button>
                {entry.baselineAnchor && <button type="button" className="block text-blue-200" onClick={() => openDocument(entry.baselineAnchor!.documentId, entry.baselineAnchor!.page)}>פתח את הבסיס החוזי הנוסף</button>}
            </div>)}</div>
        </details>}
        {Boolean(plan?.missingEvidence.length) && <details className="text-xs text-amber-200">
            <summary className="cursor-pointer">מקורות שלא אומתו בעת הקישור</summary>
            <ul className="space-y-2 mt-2">{plan!.missingEvidence.map((item, index) => <li key={`${item.findingId}:${index}`}>
                {item.reason === 'SOURCE_NOT_READY' || item.reason === 'BASELINE_NOT_READY'
                    ? 'קריאת המקור אינה מלאה או שגרסתו אינה מאומתת. הוא לא שימש להוכחת כפילות או תנאי מחייב.'
                    : item.reason === 'BASELINE_SOURCE_NOT_AVAILABLE' ? 'המסמך או עמוד הייחוס ששימש להשוואה אינו זמין בבדיקה הנוכחית. ההפניה נשמרה ולא נחשבה לציטוט שגוי.'
                    : 'מקור שנשמר בהיסטוריה הקודמת אינו תואם עוד לטקסט הזמין. הוא לא שימש כהוכחה בקישור הנוכחי.'}
            </li>)}</ul>
        </details>}
        {Boolean(plan?.financialLinks.length) && <button type="button" disabled={busy} onClick={() => void openFinancialRecords()}
            className="text-sm font-bold text-emerald-200 disabled:opacity-50">פתח תמחור ומכתב שמורים</button>}
        {records && <div className="space-y-4" aria-label="תמחור ומכתבים שמורים">
            {records.ledger.map(item => <article key={String(item.id)} className="p-3 rounded-xl border border-white/10 space-y-2">
                <h5 className="text-sm font-bold text-emerald-200">התמחור השמור</h5>
                <p className="text-xs leading-7 text-gray-200">{String(item.description || '')}</p>
                <p className="text-sm text-gray-100">סכום לפני מע״מ: {money(getLedgerRowAmount(item as LedgerLikeRow))}</p>
                <p className="text-xs text-gray-400">נתוני התמחור מוצגים מהרישום הקיים. שגיאת המקור מסומנת למעלה.</p>
            </article>)}
            {records.letters.map(letter => <details key={String(letter.id)} className="p-3 rounded-xl border border-white/10">
                <summary className="text-sm text-emerald-200 cursor-pointer">המכתב השמור: {String(letter.subject || '')}</summary>
                <div className="whitespace-pre-wrap text-sm leading-7 text-gray-200 mt-3">{String(letter.content || '')}</div>
            </details>)}
        </div>}
    </section>;
}
