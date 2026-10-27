import React from 'react';
import type { WorkChangeReview } from '@/utils/work-change-review';
import type { EvidenceAnchor } from '@/utils/radar-evidence-assessment';

const money = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(value);
const quantity = (value: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 6 }).format(value);
const units: Record<string, string> = { m: 'מ׳', pcs: 'יח׳', m2: 'מ״ר', m3: 'מ״ק', lot: 'קומפלט' };
const unit = (value: string) => units[value] || value;
const components: Record<string, string> = { METHOD_WORK: 'ביצוע העבודה', MATERIAL_SUPPLY: 'אספקת חומרים וצנרת', SHAFT: 'פירים ושוחות', ANCILLARY: 'עבודות נלוות' };
const confirmations: Record<string, string> = {
    MEASURED_SCOPE: 'כמויות והיקף: לאשר אילו מקטעים ומבנים הוחלפו ומהן הכמויות למדידה בכל שיטה. אורך אספקה מחושב אינו מוכיח אורך התקנה או פחת.',
    PRICE_BASIS_AND_APPROVAL: 'בסיס המחיר והאישור: לזהות את כתב הכמויות והגרסה החלים, את ההסכמה המחייבת ואת מקור המחיר המעודכן. סכום שמצוטט במכתב אינו מחליף את המקור והסעיפים שלו.',
    INCLUSIONS_AND_RESPONSIBILITIES: 'תנאי ההצעה וחלוקת האחריות: לוודא מי נושא בעבודות הנלוות ומה כלול בכל מחיר, לרבות הכנות, גישה, תנועה, מים ותנאי הקרקע.',
    PRICE_ADJUSTMENTS: 'הנחות ותוספות: לאשר על אילו סעיפים חלות ההנחות והאם תוספת או רווח שנדרשו אושרו. אחוז שמופיע בפנייה אינו מוחל אוטומטית.',
    HISTORICAL_VAT_RATE: 'מע״מ היסטורי: סכומי המקור נשמרו כפי שנדפסו. שיעור הפרויקט הנוכחי הוא 18%; אין להעתיק שיעור היסטורי לרישום חדש. ההשוואה היא לפני מע״מ.',
    SOURCE_READING: 'קריאת מקורות: להשלים או לאמת את המקורות המסומנים. מספר שנצפה במקור כזה אינו סכום מאומת או הסכמה מחייבת.',
    PRINTED_ARITHMETIC: 'מספרים ועיגול: לאמת את ההפרשים בין כמות כפול מחיר לסכום המודפס ואת שיעורי המע״מ שהסדר שלהם בטקסט אינו ברור. המספרים המקוריים לא תוקנו אוטומטית.',
};

export const WorkChangeFinancialReadiness: React.FC<{ review: WorkChangeReview; projectId: string }> = ({ review, projectId }) => {
    const result = review.financialReadiness;
    if (!result || !result.confirmations.length) return null;
    const sourceName = (id: string) => review.sources.find(source => source.id === id)?.title || id;
    const sourceLink = (id: string, page: number | null = null) => <a className="text-blue-300 underline text-xs" target="_blank" rel="noreferrer"
        href={`/api/documents/file?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(id)}${page ? `#page=${page}` : ''}`}>
        {sourceName(id)}{page ? ` · עמוד ${page}` : ''} · מקור</a>;
    const evidence = (anchors: EvidenceAnchor[]) => anchors.map((anchor, index) => <div key={index} className="space-y-2">
        <blockquote className="whitespace-pre-wrap break-words text-xs leading-6">{anchor.quote}</blockquote>{sourceLink(anchor.documentId, anchor.page)}
    </div>);
    return <section className="ti-work-change-readiness" aria-label="מוכנות להשוואה כספית">
        <h3 className="font-bold text-blue-200">מוכנות להשוואה כספית</h3>
        <p className="text-sm text-gray-300">הנתונים הבאים אינם תוספת מאושרת. סכומי מסמכים שלמים אינם מחיר ההיקף שהוחלף; לא חושב הפרש בין היקפים שונים.</p>
        {result.sourceTotals.filter(total => review.sources.some(source => source.id === total.sourceId && source.role !== 'CONTRACT')).map((total, index) =>
            <p key={`quote-${index}`} className="text-sm">סיכום מסמך החלופה לפני מע״מ: <strong>{money(total.netExclVat)}</strong> · {sourceLink(total.sourceId)}. זהו סיכום המסמך כולו; ההיקף והאישור נבחנים בנפרד.</p>)}
        {result.quantities.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm text-right"><thead><tr className="text-gray-400">
            {['רכיב', 'בשורות המקור שנבחרו', 'בשורות החלופה שנבחרו'].map(label => <th className="p-2" key={label}>{label}</th>)}
        </tr></thead><tbody>{result.quantities.map(item => <tr key={item.component} className="border-t border-white/10 align-top">
            <th className="p-2 font-normal">{components[item.component]}</th>{[item.baseline, item.proposal].map((side, index) => <td key={index} className="p-2 space-y-2">
                {side.map(value => <div key={`${value.sourceId}:${value.unit}`} className="space-y-1">
                    <strong>{quantity(value.value ?? value.observedValue)} {unit(value.unit)}</strong>
                    <p className="text-xs text-gray-400">סכום הכמויות בשורות של מסמך זה בלבד.</p>
                    {value.value === null && <p className="text-xs text-amber-200">נצפה במקור; ההיקף טעון אימות {value.issues.includes('ambiguous_item_scope') ? 'לפי המבנה והפרק, משום שמספר סעיף חוזר.' : 'עקב קריאה שלא אומתה.'}</p>}
                    {value.derivedLengthM !== null && <p className="text-xs text-gray-300">{quantity(value.lengthPerPieceM!)} מ׳ ליחידת צינור במקור; אורך אספקה מחושב {quantity(value.derivedLengthM)} מ׳. יחידת התשלום נשארת {unit(value.unit)}.</p>}
                    <details className="text-xs space-y-2"><summary className="cursor-pointer text-blue-200">{sourceName(value.sourceId)} · שורות המקור</summary>{evidence(value.evidence)}</details>
                </div>)}
            </td>)}</tr>)}</tbody></table></div>}
        {result.sourceTotals.length > 0 && <details className="space-y-3"><summary className="cursor-pointer text-blue-200 font-bold text-sm">סיכומי המחיר המפורשים במסמכים</summary>
            <p className="text-xs text-gray-300">כל סיכום מתייחס למסמך כולו, כולל סעיפים שאינם בהכרח חלק מהשינוי. הוא אינו בסיס חוזי מאושר ואינו חיבור של שורות ההשוואה.</p>
            {result.sourceTotals.map((total, index) => <article key={`${total.sourceId}:${index}`} className="rounded-xl border border-white/10 p-3 space-y-2 text-sm">
                <p className="font-bold">{sourceName(total.sourceId)}</p>
                <p>סכום לפני מע״מ לפי סיכום המסמך: <strong>{money(total.netExclVat)}</strong></p>
                {total.netExclVat === null && <p className="text-amber-200 text-xs">נצפה {money(total.observedNet)}; הקריאה או משוואת הסיכום טעונות אימות.</p>}
                <p className="text-xs text-gray-300">מע״מ מודפס {money(total.observedVat)} · כולל מע״מ {money(total.observedGross)} · שיעור לפי הסכומים {total.derivedVatPercent ?? '—'}%.</p>
                {total.issues.includes('printed_vat_rate_unverified') && <p className="text-xs text-amber-200">סדר הספרות בשיעור המודפס טעון אימות: {total.printedVatPercent}%. לא בוצע תיקון למקור.</p>}
                <details className="space-y-2"><summary className="cursor-pointer text-blue-200 text-xs">ציטוט סיכום המחיר</summary>{evidence(total.evidence)}</details>
            </article>)}
        </details>}
        {result.mentions.length > 0 && <details className="space-y-3"><summary className="cursor-pointer text-blue-200 font-bold text-sm">סכומים שדווחו בפניות — נפרדים מסיכומי ההצעות</summary>
            <p className="text-xs text-gray-300">מוצגים כהופעה בטקסט, ללא קביעה שמדובר במחיר כולל, בבסיס מאושר או בזכאות. תכנון נבחן בנפרד.</p>
            {result.mentions.map((item, index) => <div key={index} className="rounded-xl border border-white/10 p-3 space-y-2 text-sm">
                <p>{money(item.value)} · {item.canCompare ? 'דווח במקור קריא; משמעותו והאישור טעונים בדיקה.' : 'קריאת המקור או המספרים לא אומתה; זהו מספר שנצפה בלבד.'}</p>{evidence(item.evidence)}
            </div>)}
        </details>}
        {(result.terms.length > 0 || result.adjustments.length > 0) && <details className="space-y-3"><summary className="cursor-pointer text-blue-200 font-bold text-sm">תנאי ההצעה, הנחות ותוספות שנמצאו</summary>
            {result.terms.map((item, index) => <div key={`term-${index}`} className="rounded-xl border border-white/10 p-3 space-y-2">{evidence([item.evidence])}</div>)}
            {result.adjustments.map((item, index) => <div key={`adjustment-${index}`} className="rounded-xl border border-white/10 p-3 space-y-2"><p className="text-sm">{item.percent}% בטקסט — טרם הוחל בחישוב.</p>{evidence([item.evidence])}</div>)}
        </details>}
        <div className="space-y-2"><h4 className="font-bold text-amber-200 text-sm">ההשלמות הדרושות לחישוב מבוסס</h4>
            <ul className="list-disc pr-5 space-y-2 text-sm text-gray-200">{result.confirmations.map(item => <li key={item.code}>{confirmations[item.code]}</li>)}</ul>
        </div>
    </section>;
};
