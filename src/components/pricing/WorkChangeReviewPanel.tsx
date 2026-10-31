"use client";

import React from 'react';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import type { WorkChangeFact, WorkChangeReview } from '@/utils/work-change-review';
import { requestWorkChangeReview } from './workChangeReviewApi';
import { WorkChangeFinancialReadiness } from './WorkChangeFinancialReadiness';

const labels: Record<string, string> = {
    BASELINE_WORK: 'עבודה מקורית', PROPOSED_WORK: 'עבודה חלופית', BASELINE_TOTAL: 'סכום במקור המקורי',
    PROPOSAL_TOTAL: 'סכום בהצעה', DESIGN_FEE: 'תכנון ושכר טרחה', CLAIM_TOTAL: 'סכום בפנייה',
    AGREEMENT: 'נוסח הסכמה או תנאי', OPEN_QUESTION: 'שאלה או פרט לבירור',
    source_reading_unverified: 'קריאת המקור לא אומתה במלואה', source_reading_requires_review: 'יש מקורות שקריאתם דורשת השלמה או אימות מספרים',
    source_reading_failed: 'קריאת אחד המקורות לא הושלמה; התוכן הקודם נשמר',
    primary_source_missing: 'מסמך המקור של השאלה אינו זמין', fact_quote_unverified: 'פרט ללא ציטוט תואם נפסל',
    fact_kind_unverified: 'סוגו של פרט מהמקור לא הובהר', work_comparison_missing: 'לא נמצאה עדיין השוואה מבוססת בין העבודה המקורית לחלופה',
    comparison_sources_unverified: 'חסרים מקורות להשוואה שהוצעה', no_grounded_facts: 'לא נמצאו עדיין פרטים עם ציטוט מאומת',
    amount_unverified: 'הסכום לא אומת מול המקור', vat_basis_unverified: 'לא הובהר שהסכום לפני מע״מ',
    quantity_unverified: 'הכמות לא אומתה מול המקור', quantity_unknown: 'חסרה כמות מפורשת להשוואה',
    quantity_differs: 'הכמויות שונות; הפרש הסכומים אינו תוספת מוכחת עבור שינוי השיטה',
    unit_differs: 'יחידות המדידה שונות או אינן ידועות', composition_unverified: 'לא הוכח שהיקף העבודה והכלול במחיר זהים',
    source_fact_requires_review: 'אחד מפרטי ההשוואה עדיין דורש בדיקה', design_scope_unverified: 'נדרש לאמת שמדובר בתשלום עבור תכנון',
    unit_price_not_total: 'זהו מחיר ליחידה; הוא אינו סכום כולל של העבודה',
    comparison_context_requires_review: 'לא כל קטעי העבודה הושוו; נדרשת בדיקה של הקטעים המפורטים במקורות',
    work_role_unverified: 'סיווג העבודה כחלופה אינו נתמך בתפקיד מסמך המקור',
    scope_roles_unverified: 'כיוון ההחלפה בין המקור להצעה לא אומת',
    scope_component_unverified: 'לא אומת ששתי השורות מתארות את אותו רכיב עבודה',
    scope_basis_unverified: 'לא נמצא ציטוט הקושר את העבודות לשינוי הנדון',
    scope_composition_unverified: 'הרכב ההשוואה שהוצע לא הובהר',
    financial_scope_not_established: 'התאמת רכיבי העבודה אינה קובעת תוספת כספית; נדרשים היקף, תנאים ובסיס מחיר בני השוואה',
    document_status_unverified: 'המעמד המחייב של אחד המקורות לא הובהר; מוצג תוכן המקור בלבד',
    ambiguous_item_scope: 'מספר סעיף חוזר בכמה מקומות; אין לחבר את הכמויות בלי אימות המבנה והפרק',
    printed_rounding_requires_review: 'בשורת המקור יש עיגול או הפרש שעדיין טעון אימות',
    quantities_not_reconciled: 'יש כמה שורות או מבנים; הכמויות הוצגו בנפרד ולא חוברו',
    scope_rows_unmatched: 'יש שורות מועמדות שטרם נקשרו להשוואה; הן מוצגות בנפרד ואינן מוכיחות את היקף ההחלפה',
};
const components: Record<string, string> = { METHOD_WORK: 'ביצוע העבודה', MATERIAL_SUPPLY: 'אספקת חומרים וצנרת', SHAFT: 'פירים ושוחות', ANCILLARY: 'עבודות נלוות' };
const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(value);
const explain = (issue: string) => labels[issue] || 'נדרשת בדיקה נוספת של פרט במקורות';
const sourceUrl = (projectId: string, documentId: string, page: number | null = null) =>
    `/api/documents/file?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(documentId)}${page ? `#page=${page}` : ''}`;

interface ContentProps { review: WorkChangeReview; projectId: string }
export const WorkChangeReviewContent: React.FC<ContentProps> = ({ review, projectId }) => {
    const designFees = review.facts.filter(fact => fact.kind === 'DESIGN_FEE' && fact.confirmed && fact.amountExclVat !== null)
        .filter((fact, index, values) => values.findIndex(other => other.sourceId === fact.sourceId && other.amountExclVat === fact.amountExclVat) === index);
    const renderFact = (fact: WorkChangeFact) => {
        const source = review.sources.find(source => source.id === fact.sourceId);
        return <article key={fact.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 space-y-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{fact.kind.endsWith('_WORK') && !fact.confirmed ? 'קטע עבודה שסיווגו טרם אומת' : labels[fact.kind]}</strong>
                <span className={fact.confirmed ? 'text-emerald-300' : 'text-amber-300'}>{fact.confirmed ? 'הציטוט והנתון נבדקו במקור; אין בכך אישור לתשלום' : 'טעון אימות'}</span></div>
            <blockquote className="whitespace-pre-wrap break-words text-sm leading-7 text-gray-200 border-r-2 border-blue-400/60 pr-3">{fact.evidence.quote}</blockquote>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-400">כמות ויחידה</dt><dd>{fact.quantity ?? '—'} {fact.unit || ''}</dd></div>
                <div><dt className="text-gray-400">סכום מאומת לפני מע״מ</dt><dd>{money(fact.amountExclVat)}</dd></div></dl>
            {fact.observedAmount !== null && fact.amountExclVat === null && <p className="text-xs text-amber-200">מספר שהופיע במקור וטעון בדיקה: {money(fact.observedAmount)}. הוא לא נוסף לחישוב.</p>}
            {fact.issues.length > 0 && <ul className="text-xs text-amber-200 list-disc pr-4 space-y-1">{fact.issues.map(issue => <li key={issue}>{explain(issue)}</li>)}</ul>}
            <a className="text-xs text-blue-300 underline" href={sourceUrl(projectId, fact.sourceId, fact.evidence.page)} target="_blank" rel="noreferrer">
                [{review.sources.findIndex(source => source.id === fact.sourceId) + 1}] {source?.title || fact.sourceId}{fact.evidence.page ? ` · עמוד ${fact.evidence.page}` : ''} · פתיחת קובץ המקור</a>
        </article>;
    };
    const groups = [
        { title: 'העבודות והסכומים המקוריים', matches: (fact: WorkChangeFact) => fact.kind === 'BASELINE_TOTAL' || (fact.kind === 'BASELINE_WORK' && fact.confirmed) },
        { title: 'החלופה והסכומים בפניות', matches: (fact: WorkChangeFact) => ['PROPOSAL_TOTAL', 'CLAIM_TOTAL'].includes(fact.kind) || (fact.kind === 'PROPOSED_WORK' && fact.confirmed) },
        { title: 'תכנון ושכר טרחה', matches: (fact: WorkChangeFact) => fact.kind === 'DESIGN_FEE' },
        { title: 'הסכמות, תנאים ושאלות פתוחות', matches: (fact: WorkChangeFact) => ['AGREEMENT', 'OPEN_QUESTION'].includes(fact.kind) },
        { title: 'קטעי עבודה שטרם סווגו באופן מאומת', matches: (fact: WorkChangeFact) => fact.kind.endsWith('_WORK') && !fact.confirmed },
    ];
    return <div className="ti-work-change" dir="rtl">
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-sm text-amber-100">
            בדיקת מקורות והשוואת עבודה. לא אושרה דרישת תשלום ולא שונו הסכומים בפרויקט.
        </div>
        <p className="text-sm text-gray-300">נכללו {review.sources.length} מסמכים. {review.sources.filter(source => !source.canCompare).length} מהם דורשים השלמת קריאה או אימות. הפרטים והציטוטים נפתחים לפי הצורך.</p>
        <WorkChangeFinancialReadiness review={review} projectId={projectId} />
        {review.scopeComparisons?.length > 0 && <section className="space-y-3"><h3 className="font-bold text-blue-200">התאמת הרכב העבודות</h3>
            <p className="text-sm text-gray-300">אלה רכיבים שנקשרו לשינוי המתואר במקורות. קריאות ומעמד מחייב נבדקים בנפרד. שורות ממסמכים או מבנים שונים לא חוברו.</p>
            {review.scopeComparisons[0].evidence[0] && <blockquote className="whitespace-pre-wrap break-words text-sm leading-7 border-r-2 border-blue-400/60 pr-3">{review.scopeComparisons[0].evidence[0].quote}</blockquote>}
            <p className="text-sm">תוספת כספית מאומתת <strong>—</strong></p>
            {review.scopeComparisons.map(pair => <article key={pair.id} className="rounded-xl border border-blue-400/25 p-4 space-y-4">
                <h4 className="font-bold text-blue-200">{components[pair.component]}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[
                    { title: 'בכתב הכמויות המקורי', ids: pair.baselineIds }, { title: 'בהצעת החלופה', ids: pair.proposalIds },
                ].map(side => <div key={side.title} className="space-y-2"><h5 className="font-bold text-sm">{side.title}</h5>
                    {side.ids.map(id => { const row = review.tableRows.find(row => row.id === id); if (!row) return null;
                        const source = review.sources.find(source => source.id === row.sourceId);
                        return <details key={id} className="rounded-xl border border-white/10 p-3 text-sm space-y-2">
                            <summary className="cursor-pointer text-blue-200">{row.itemCode} · {row.quantity} {row.unit}</summary>
                            <blockquote className="whitespace-pre-wrap break-words text-xs leading-6">{row.evidence.quote}</blockquote>
                            <a className="text-blue-300 underline text-xs" href={sourceUrl(projectId, row.sourceId, row.evidence.page)} target="_blank" rel="noreferrer">[{review.sources.findIndex(source => source.id === row.sourceId) + 1}] {source?.title} · מקור</a>
                        </details>; })}
                </div>)}</div>
                <details className="text-sm space-y-2"><summary className="cursor-pointer text-blue-200">הקשר בין המקור לחלופה</summary>
                    {pair.evidence.map((evidence, index) => <div key={index} className="space-y-2">
                        <blockquote className="whitespace-pre-wrap break-words text-xs leading-6">{evidence.quote}</blockquote>
                        <a className="text-blue-300 underline text-xs" href={sourceUrl(projectId, evidence.documentId, evidence.page)} target="_blank" rel="noreferrer">{review.sources.find(source => source.id === evidence.documentId)?.title} · מקור ההקשר</a>
                    </div>)}
                </details>
                <p className="text-xs text-amber-200">{pair.composition === 'DIFFERENT' ? 'הרכב או מאפייני העבודה שונים; אין להסיק תוספת מהפרש הסכומים.' : 'הקשר בין הרכיבים הוצג; שקילות מלאה של ההיקף והכלול במחיר לא נקבעה.'}</p>
                <ul className="text-xs text-amber-200 list-disc pr-4 space-y-1">{pair.issues.map(issue => <li key={issue}>{explain(issue)}</li>)}</ul>
            </article>)}
        </section>}
        {review.scopeUnmatchedIds?.length > 0 && <details className="rounded-xl border border-amber-400/25 p-4 space-y-3">
            <summary className="cursor-pointer font-bold text-amber-200">שורות שטרם הותאמו להרכב השינוי · {review.scopeUnmatchedIds.length}</summary>
            {review.scopeUnmatchedIds.map(id => { const row = review.tableRows.find(row => row.id === id); if (!row) return null;
                return <div key={id} className="text-sm space-y-2"><p>{row.itemCode} · {row.quantity} {row.unit}</p>
                    <blockquote className="whitespace-pre-wrap break-words text-xs leading-6">{row.evidence.quote}</blockquote>
                    <a className="text-blue-300 underline text-xs" href={sourceUrl(projectId, row.sourceId, row.evidence.page)} target="_blank" rel="noreferrer">{review.sources.find(source => source.id === row.sourceId)?.title} · מקור</a>
                </div>; })}
        </details>}
        {designFees.length > 0 && <section className="rounded-xl border border-blue-400/25 p-4 space-y-2"><h3 className="font-bold text-blue-200">שכר טרחה בהצעת המתכנן</h3>
            {designFees.map(fact => <p key={fact.id} className="text-sm"><strong>{money(fact.amountExclVat)} לפני מע״מ</strong> · <a className="text-blue-300 underline" href={sourceUrl(projectId, fact.sourceId, fact.evidence.page)} target="_blank" rel="noreferrer">{review.sources.find(source => source.id === fact.sourceId)?.title} · מקור</a></p>)}
            <p className="text-xs text-gray-300">זהו תכנון, בנפרד מביצוע. אין בכך קביעה מי חייב לשלם אותו.</p>
        </section>}
        {review.tableRows?.length > 0 && <section className="space-y-3"><h3 className="font-bold text-blue-200">נתונים מעמודות הטבלאות</h3>
            <p className="text-xs text-gray-300">אלה נתונים כפי שנדפסו במקור. לא חוברו סכומים ממסמכים שונים ולא נקבעה זכאות לתשלום. מספר סעיף לבדו אינו מוכיח שמדובר באותו מבנה או היקף עבודה.</p>
            {review.sources.map(source => { const rows = review.tableRows.filter(row => row.sourceId === source.id);
                return rows.length > 0 ? <details key={source.id} className="rounded-xl border border-white/10 p-3 space-y-3">
                    <summary className="cursor-pointer text-sm text-blue-200">{source.title} · {rows.length} שורות</summary>
                    <p className="text-xs text-gray-300">{source.role === 'CONTRACT' ? 'נתונים ממסמך חוזה או כתב כמויות.' : 'נתונים ממסמך השינוי או פנייה קשורה; אין בכך אישור מחיר או ביצוע.'}</p>
                    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-gray-400 text-right">
                        {['סעיף', 'כמות', 'יחידה', 'מחיר יחידה במקור', 'סכום שורה במקור', 'בדיקה'].map(label => <th key={label} className="p-2 whitespace-nowrap">{label}</th>)}
                    </tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t border-white/10 align-top">
                        <td className="p-2"><details><summary className="cursor-pointer text-blue-200">{row.itemCode}</summary>
                            <blockquote className="whitespace-pre-wrap text-xs leading-6 max-w-sm mt-2">{row.evidence.quote}</blockquote>
                            <a className="text-blue-300 underline text-xs" href={sourceUrl(projectId, source.id, row.evidence.page)} target="_blank" rel="noreferrer">פתיחת קובץ המקור{row.evidence.page ? ` · עמוד ${row.evidence.page}` : ''}</a></details></td>
                        <td className="p-2">{row.quantity}</td><td className="p-2">{row.unit}</td><td className="p-2 whitespace-nowrap">{money(row.unitPrice)}</td>
                        <td className="p-2 whitespace-nowrap">{money(row.total)}<span className="block text-xs text-gray-400">{row.vatBasis === 'EXCL' ? 'לפני מע״מ' : row.vatBasis === 'INCL' ? 'כולל מע״מ' : 'בסיס המע״מ לא הובהר לשורה זו'}</span></td>
                        <td className="p-2 text-xs max-w-52 space-y-1"><p className={row.requiresReview ? 'text-amber-200' : 'text-gray-300'}>{row.arithmeticVerified ? 'תוצאת כמות כפול מחיר יחידה נבדקה' : 'נדרש לאמת עיגול/הפרש בשורת המקור'}</p>
                            {row.requiresReview && <p className="text-amber-200">נתוני השורה עדיין טעונים אימות.</p>}
                            {row.ambiguousItemCode && <p className="text-amber-200">אותו מספר מופיע בכמה מקומות; יש לאמת את המבנה והפרק לפי התיאור.</p>}</td>
                    </tr>)}</tbody></table></div>
                </details> : null; })}
        </section>}
        {review.facts.length === 0 && !review.scopeComparisons?.length && <div className="rounded-xl border border-white/10 p-5 text-gray-300">לא נמצאו עדיין פרטים עם ציטוט מאומת. פתחו את המקורות המפורטים מטה לבדיקת התוכן החסר.</div>}
        {groups.map(group => { const facts = review.facts.filter(group.matches);
            return facts.length > 0 ? <details key={group.title} aria-label={group.title} className="rounded-xl border border-white/10 p-4 space-y-3"><summary className="font-bold text-blue-200 cursor-pointer">{group.title} · {facts.length} קטעים</summary><div className="space-y-3">{facts.map(renderFact)}</div></details> : null; })}
        {review.comparisons.length > 0 && <section className="space-y-3"><h3 className="font-bold text-blue-200">השוואת היקף ועלות</h3>{review.comparisons.map(pair =>
            <div key={`${pair.baselineId}-${pair.proposalId}`} className="rounded-xl border border-white/10 p-4 text-sm space-y-2">
                <p>{pair.status === 'ARITHMETIC_ONLY' ? 'הפרש חשבוני בין נתוני המקורות בלבד; הזכאות לתשלום לא נקבעה.' : 'אין בסיס להשוואת סכומים ישירה.'}</p>
                <p>הפרש חשבוני לפני מע״מ: <strong>{money(pair.arithmeticDeltaExclVat)}</strong></p>
                {pair.issues.map(issue => <p key={issue} className="text-amber-200">{explain(issue)}</p>)}
            </div>)}</section>}
        {review.limitations.length > 0 && <section className="space-y-2"><h3 className="font-bold text-amber-200">מה עדיין דורש בדיקה</h3>
            <ul className="list-disc pr-5 space-y-2 text-sm text-gray-200">{review.limitations.map(issue => <li key={issue}>{explain(issue)}</li>)}</ul></section>}
        {review.ownerNotes.length > 0 && <section className="space-y-2"><h3 className="font-bold text-blue-200">הבהרות בעל הפרויקט</h3>{review.ownerNotes.map((note, index) => <p key={index} className="text-sm text-gray-200">{String(note.text || '')}</p>)}</section>}
        <details className="rounded-xl border border-white/10 p-4 space-y-3"><summary className="font-bold text-blue-200 cursor-pointer">מקורות שנכללו בבדיקה · {review.sources.length}</summary>{review.sources.map((source, index) =>
            <div key={source.id} className="rounded-xl border border-white/10 p-3 space-y-1 text-sm">
                <a className="text-blue-300 underline" href={sourceUrl(projectId, source.id)} target="_blank" rel="noreferrer">[{index + 1}] {source.title} · פתיחת קובץ המקור</a>
                <p className={source.canCompare ? 'text-gray-400' : 'text-amber-200'}>{source.canCompare ? 'תוכן המקור קריא; המעמד המחייב נבחן בנפרד.' : 'קריאת המקור לא אומתה במלואה.'}</p>
                {source.documentStatus === 'DRAFT' && <p className="text-amber-200">טיוטה — אין לראות בה הוראה מחייבת.</p>}
                {!source.selectionComplete && <p className="text-xs text-gray-400">נבחרו קטעים בנושא. אין להסיק מההשמטה שעבודה אינה כלולה.</p>}
                {source.readingGaps?.map(gap => <p key={gap} className="text-xs text-amber-200">{gap}</p>)}
                {source.connection === 'CANDIDATE' && <p className="text-xs text-gray-400">מקור מועמד לפי הקשר; הופעתו כאן אינה אישור לתחולתו.</p>}
            </div>)}</details>
    </div>;
};

interface PanelProps { findingId: string; projectId: string; onClose: () => void }
const WorkChangeReviewPanel: React.FC<PanelProps> = ({ findingId, projectId, onClose }) => {
    const [review, setReview] = React.useState<WorkChangeReview | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
        const controller = new AbortController(); let active = true;
        setReview(null); setError(null);
        requestWorkChangeReview(projectId, findingId, controller.signal).then(result => { if (active) setReview(result.review); })
            .catch(cause => { if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'הבדיקה לא הושלמה.'); });
        return () => { active = false; controller.abort(); };
    }, [projectId, findingId, attempt]);

    const retry = React.useCallback(() => setAttempt(value => value + 1), []);
    return <Dialog open labelledBy="work-change-review-heading" className="ti-dialog--wide ti-work-change-dialog" onClose={onClose}>
        <header className="ti-dialog__header"><div><h2 id="work-change-review-heading" className="ti-title">בדיקת מסמכי השינוי</h2><p className="ti-subtitle">העבודות המקוריות, החלופה והבסיס לסכומים</p></div><Button onClick={onClose}>סגירה</Button></header>
        {!review&&!error&&<Feedback aria-live="polite"><span className="ti-spinner" aria-hidden="true"/><p>קורא את מקורות השינוי ובודק את ההשוואה. הבדיקה הראשונה עשויה להימשך מספר דקות.</p></Feedback>}
        {error&&<Feedback tone="danger"><p>{error}</p><Button onClick={retry}>נסו שוב</Button></Feedback>}
        {review&&<><p role="status" className="ti-copy">תוצאת הבדיקה זמינה. פרטים שאינם מאומתים מסומנים במפורש.</p><WorkChangeReviewContent review={review} projectId={projectId}/></>}
    </Dialog>;
};
export default WorkChangeReviewPanel;
