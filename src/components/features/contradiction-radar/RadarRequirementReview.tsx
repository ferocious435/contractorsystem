'use client';

import { useState } from 'react';
import type { IssueRequirementReview, ReviewedRequirement } from '@/utils/radar-requirement-review';
import type { RequirementKind } from '@/utils/requirement-statement-comparison';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Button} from '@/components/ui/titanium/Button';

const labels: Record<RequirementKind, string> = { METHOD_CHANGE: 'שינוי שיטת הביצוע', SIGN_ANNEX: 'דרישה לחתימת נספח',
    BINDING_ANNEX: 'הטענה שהנספח מחייב', NO_EXTRA_PAYMENT: 'תנאי מחיר ללא תוספת', SUBMIT_PRICE: 'הגשת ניתוח מחיר',
    RESPOND: 'דרישה למענה', WAIVE_CLAIMS: 'ויתור על טענות ודרישות' };
const states: Record<ReviewedRequirement['assessment'], string> = { CONFLICT: 'נמצא ניגוד לסעיף חל', SUPPORTED: 'נמצא בסיס לסוג הדרישה',
    PROPOSED_CHANGE: 'תנאי מוצע או בחירה מותנית', NEEDS_BASIS: 'לא הוכח בסיס מחייב לדרישה' };
const reasons: Record<string, string> = {
    unsigned_annex_terms_are_proposed: 'תנאי הטופס אינם מוכיחים הסכמה. מועד ההתקשרות נשאר ריק; מצב החתימה בתקופת המסמכים מוצג בנפרד.',
    conditional_choice_is_not_unconditional_duty: 'המקור מתנה את הדרישה בבחירת הקבלן או באישור; אין להסיק ממנו חובה בלתי מותנית.',
    requirement_date_not_established: 'אין תאריך מאומת הממקם את הדרישה בתקופת המסמכים.',
    governing_precedence_not_established: 'נמצאו הוראות שונות; המסמכים הזמינים אינם מוכיחים איזו הוראה גוברת במקרה הזה.',
    requirement_authority_not_established: 'בסעיפים שנבדקו לא נמצא בסיס מספיק לדרישה המסוימת.',
    applicable_reference_clause_not_established: 'נמצא מקור ייחוס, אך תחולת הסעיף או המהדורה לא הוכחה.',
    method_authority_or_approval_conditions_not_established: 'נמצאו הוראות על שינויים ואישורים; לא הוכח שהדרישה המסוימת עומדת בתנאיהן.',
    method_authority_does_not_establish_price_or_waiver: 'סמכות לשינוי שיטה אינה מוכיחה זכות לקבוע מחיר ללא תוספת או לדרוש ויתור.',
    operative_annex_basis_not_established: 'האמירה שהנספח מחייב אינה מוכיחה שהתקיים מנגנון השינוי והאישור הנדרש.',
    price_change_mechanism_or_work_classification_not_established: 'לא הוכח שסיווג העבודה ומנגנון המחיר מאפשרים לקבוע את המחיר ללא תוספת.',
    response_period_authority_not_established: 'לא הוכח בסיס מחייב לתקופת המענה שנדרשה. מועד המענה אינו מועד לחתימת MTM.',
    governing_conditions_not_established: 'הסעיף מותנה; המקורות הזמינים אינם מוכיחים שתנאי תחולתו התקיימו.',
    requested_response_period_below_contractual_minimum: 'נדרש מענה בתקופה קצרה מהמינימום המותר בסעיף, באותן יחידות ומאותו מועד התחלה.',
    method_instruction_waives_required_approval: 'הדרישה מתירה ביצוע ללא האישור שהסעיף מחייב לקבל.',
    method_instruction_exceeds_explicit_authority: 'הדרישה חורגת מגבול סמכות מפורש לשינוי השיטה.',
    binding_annex_assertion_without_required_signature: 'הנספח מוצג כמחייב אף שהמקור מתעד שחסרה חתימה שהסעיף דורש.',
    no_extra_payment_against_explicit_price_adjustment: 'תנאי ללא תוספת עומד מול הוראה מפורשת להתאמת התמורה לשינוי.',
    waiver_against_explicit_protection: 'נדרש ויתור שהסעיף אוסר לדרוש.',
    explicit_method_authority_matches_instruction: 'סוג ההוראה תואם סמכות מפורשת שנמצאה. המחיר, החתימה והמועד נבדקים בנפרד.',
    explicit_annex_signature_duty: 'נמצאה חובה מפורשת לחתימת נספח מהסוג שנדרש.',
    explicit_price_analysis_submission_duty: 'נמצאה חובה מפורשת להגשת ניתוח מחיר; אין בכך אישור למחיר עצמו.',
    price_analysis_item_not_established: 'הבקשה אינה מציינת איזה פריט יש לתמחר; אין להסיק ממנה שלא הוגש תמחור לקידוח או שלא מתנהל עליו משא ומתן.',
    referenced_edition_not_proven: 'לא הוכח שהמהדורה הזמינה היא המהדורה החלה בפרויקט.',
    referenced_section_not_proven: 'לא הוכחה תחולת הפרק או הסעיף המסוים לפי שרשרת ההפניות.',
    reference_publication_after_available_period: 'המקור פורסם לאחר התקופה הנבדקת ואינו משמש בסיס לדרישות באותה תקופה.',
    no_applicable_contractual_chain: 'לא נמצאה שרשרת הפניות מחייבת מהפרויקט לסעיף.',
    project_source_not_ready: 'קריאת המקור או מעמדו אינם מאפשרים להשתמש בו כבסיס מחייב.',
    reference_text_unavailable: 'טקסט המקור הנדרש אינו זמין להשוואה.',
    reference_context_unavailable: 'לא ניתן היה להשלים את בדיקת מקורות הייחוס; הם לא הונחו כמחייבים.',
};
const describe = (reason: string) => reasons[reason] || 'המקור אינו מוכיח את תנאי תחולת הדרישה.';
const dateLabel = (date: string | null) => date ? date.split('-').reverse().join('.') : 'ללא תאריך מאומת';

export function RadarRequirementReview({ value, projectId, openDocument }: {
    value?: IssueRequirementReview; projectId?: string; openDocument: (id: string, page: number | null) => void;
}) {
    const [referencePage, setReferencePage] = useState<{ id: string; page: number; title: string } | null>(null);
    if (!value || value.version !== 'requirement-basis-v3' || !Array.isArray(value.requirements)) return null;
    const groups = Object.keys(labels).flatMap(kind => {
        const entries = value.requirements.filter(item => item.kind === kind).sort((a, b) =>
            Number(b.assessment === 'CONFLICT') - Number(a.assessment === 'CONFLICT') || (b.date || '').localeCompare(a.date || ''));
        return entries.length ? [{ kind: kind as RequirementKind, entries, latest: entries[0] }] : [];
    });
    return <section aria-label="בדיקת בסיס הדרישות" className="ti-radar-section">
        <h5 className="text-sm font-bold text-violet-200">בדיקת הבסיס לדרישות MTM</h5>
        <p className="text-xs text-gray-400 leading-6">הדרישות הושוו למסמכי הפרויקט ולהפניות החלות. סמכות לשינוי שיטה אינה מוכיחה הסכמה למחיר או לוויתור.</p>
        {groups.length === 0 && <p className="text-xs text-gray-300">לא נמצאה דרישה מסוימת נוספת לבדיקה בתקופת המסמכים.</p>}
        {groups.map(({ kind, entries, latest }) => <details key={kind} className="rounded-lg border border-white/10 p-3 text-xs">
            <summary className="cursor-pointer leading-6"><span className="font-bold text-gray-100">{labels[kind]}</span>
                <span className={latest.assessment === 'CONFLICT' ? 'text-red-200' : 'text-amber-100'}> · {states[latest.assessment]}</span></summary>
            <p className="mt-2 text-gray-300 leading-6">{latest.reasons.map(describe).join(' ')}</p>
            {entries.map(item => <details key={item.id} className="mt-3 border-t border-white/5 pt-2">
                <summary className="cursor-pointer text-gray-400">{dateLabel(item.date)} · {item.documentTitle} · {states[item.assessment]}</summary>
                <blockquote className="mt-2 text-gray-200 leading-6 whitespace-pre-wrap">{item.anchor.quote}</blockquote>
                {item.kind === 'SUBMIT_PRICE' && <p className="mt-1 text-violet-200">{item.requestedObject === 'SHAFTS' ? 'ניתוח מחיר לשוחות; אינו הסכמה למחיר הקידוח.'
                    : item.requestedObject === 'DRILLING' ? 'ניתוח מחיר לקידוח; בקשת התמחור אינה אישור למחיר.' : 'הפריט לתמחור לא נקבע בבקשה עצמה.'}</p>}
                <button type="button" className="mt-1 text-blue-300" onClick={() => openDocument(item.documentId, item.anchor.page)}>פתח את מקור הדרישה</button>
                <p className="mt-2 leading-6 text-gray-300">{item.reasons.map(describe).join(' ')}</p>
                {item.basis.length === 0 && <p className="mt-2 text-amber-200">לא נמצא סעיף זמין שמבסס את הדרישה. מגבלות מקורות הייחוס מפורטות למטה.</p>}
                {item.basis.map((source, index) => <details key={`${source.anchor.documentId}:${source.anchor.start}:${index}`} className="mt-3 p-3 bg-black/20 rounded-lg">
                    <summary className="cursor-pointer text-gray-200">{source.documentTitle}{source.anchor.page ? ` · עמוד ${source.anchor.page}` : ''}
                        {' · '}{source.applicability !== 'CONFIRMED' ? 'תחולת הסעיף לא הוכחה'
                            : source.relation === 'INCOMPATIBLE' ? 'הסעיף שמול הדרישה' : source.relation === 'COMPATIBLE' ? 'הסעיף שמבסס את סוג הדרישה' : 'סעיף קשור; אינו מוכיח לבדו את הדרישה'}</summary>
                    {source.applicability !== 'CONFIRMED' && <p className="mt-2 text-amber-200">{describe(source.reason)}</p>}
                    <blockquote className="mt-2 leading-6 text-gray-300 whitespace-pre-wrap">{source.anchor.quote}</blockquote>
                    {source.referenceDocumentId ? projectId && source.anchor.page && <button type="button" className="mt-2 text-blue-300"
                        onClick={() => setReferencePage({ id: source.referenceDocumentId!, page: source.anchor.page!, title: source.documentTitle })}>פתח עמוד מקור כאן</button>
                        : <button type="button" className="mt-2 text-blue-300" onClick={() => openDocument(source.anchor.documentId, source.anchor.page)}>פתח סעיף במסמך המקור</button>}
                    {source.chain.map((link, chainIndex) => <div key={`${link.sourceDocumentId}:${chainIndex}`} className="mt-3 border-t border-white/10 pt-2">
                        <p className="text-violet-200">הפניה: {link.sourceTitle} ← {link.targetTitle}</p>
                        <blockquote className="mt-1 leading-6 text-gray-400">{link.quote}</blockquote>
                    </div>)}
                </details>)}
            </details>)}
        </details>)}
        {value.referenceGaps.length > 0 && <details className="text-xs text-amber-200">
            <summary className="cursor-pointer">מגבלות בבסיס המסמכים ({value.referenceGaps.length})</summary>
            <ul className="mt-2 space-y-3">{value.referenceGaps.map(gap => <li key={`${gap.documentId}:${gap.reason}`}>
                {gap.documentTitle && <p className="font-bold">{gap.documentTitle}</p>}<p className="mt-1 leading-6">{describe(gap.reason)}</p>
                {gap.quote && <blockquote className="mt-1 text-gray-400 leading-6">{gap.quote}</blockquote>}
            </li>)}</ul>
        </details>}
        {referencePage && projectId && <Dialog open labelledBy="radar-reference-title" className="ti-source-dialog" onClose={()=>setReferencePage(null)}><header className="ti-dialog__header"><h2 id="radar-reference-title" className="ti-section-title">{referencePage.title} · עמוד {referencePage.page}</h2><Button onClick={()=>setReferencePage(null)}>סגירה</Button></header><p className="ti-meta">תצוגת העמוד אינה מאשרת את קריאת הספרייה כולה או את תחולת הסעיף.</p><iframe title="עמוד מקור ייחוס" className="ti-source-frame" src={`/api/reference-library/text?${new URLSearchParams({ projectId, referenceId: referencePage.id, page: String(referencePage.page) })}`}/></Dialog>}
    </section>;
}
