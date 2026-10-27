import type { IssueHistoryAssessment, IssueAspect, IssueState } from '@/utils/radar-issue-history';
import type { IssueTimingReview } from '@/utils/radar-issue-timing';
import type { CompletionDeadlineReview } from '@/utils/completion-deadline-review';
import { explainLetterResponseClock } from './utils/issueTimingDisplay';
import { RadarRequirementReview } from './RadarRequirementReview';
import type { IssueRequirementReview } from '@/utils/radar-requirement-review';

const aspects: { key: IssueAspect; label: string }[] = [
    { key: 'METHOD', label: 'שיטת הביצוע' }, { key: 'SIGNATURE', label: 'חתימת הנספח' }, { key: 'PRICE', label: 'הסכמה על המחיר' },
];
const states: Record<IssueState, string> = {
    UNKNOWN: 'אין אישור מתועד', PROPOSED: 'תנאים מוצעים; אין הסכמה מתועדת', PENDING: 'ממתין לאישור',
    CONDITIONAL: 'אישור עקרוני או מותנה', APPROVED: 'אושר לביצוע', NOT_SIGNED: 'טרם נחתם בתקופת המסמכים',
    SIGNED: 'חתימה מתועדת של שני הצדדים', REFUSED: 'סירוב מפורש לחתימה', AGREED: 'מחיר מוסכם ומתועד', DISPUTED: 'עמדות סותרות; אין הסכמה מוכחת',
};
function dateLabel(date: string | null) { return date ? date.split('-').reverse().join('.') : 'תאריך לא מאומת'; }

export function RadarIssueHistory({ value, openDocument }: {
    value: unknown; openDocument: (id: string, page: number | null) => void;
}) {
    if (!value || typeof value !== 'object') return null;
    const history = value as IssueHistoryAssessment & { timing?: IssueTimingReview; completionBasis?: CompletionDeadlineReview | null;
        requirementReview?: IssueRequirementReview; projectId?: string };
    if (history.version !== 'aspect-history-v1' || !history.aspects || !Array.isArray(history.events)) return null;
    return <section aria-label="היסטוריית MTM" className="ti-radar-section">
        <div>
            <h4 className="text-sm font-bold text-blue-200">היסטוריית MTM — שיטה, חתימה ומחיר</h4>
            <p className="text-xs text-gray-400 mt-2">מצב לפי המסמכים עד {dateLabel(history.evidenceThrough)}. אישור שיטה אינו מוכיח חתימה או מחיר מוסכם.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {aspects.map(({ key, label }) => <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-gray-400">{label}</div>
                <div className="text-sm font-bold text-amber-200 mt-2">{states[history.aspects[key]?.state] || states.UNKNOWN}</div>
                {history.aspects[key]?.date && <div className="text-xs text-gray-500 mt-2">ראיה מתאריך {dateLabel(history.aspects[key].date)}</div>}
            </div>)}
        </div>
        {history.timing && <div className="p-3 rounded-xl border border-white/10 space-y-3">
            <h5 className="text-sm font-bold text-blue-200">בדיקת מועדים והתחייבויות</h5>
            <p className="text-sm text-gray-200">{history.timing.confirmedConflicts.length
                ? 'נמצאה אי-עמידה מתועדת במועד מחייב. חתימה מאוחרת אינה מבטלת את העובדה ההיסטורית.'
                : 'לא הוכחה הפרה של מועד חוזי מחייב ל-MTM. בקשת תגובה, תנאי מעבר שיטה ומועד השלמת הפרויקט נבחנים בנפרד.'}</p>
            {history.completionBasis?.status === 'BASIS_NOT_FOUND_IN_READABLE_SOURCES' && <p className="text-xs text-amber-200">
                מועד ההשלמה {history.completionBasis.referenceDates.map(dateLabel).join(', ')} מוזכר בהתכתבות. הסכם המקדמה עצמו לא אותר במקורות הקריאים, ולכן ההפניה אינה מוכיחה הפרת מועד של MTM.
            </p>}
            {history.timing.confirmedConflicts.map((conflict, index) => <div key={`timing-conflict-${index}`} className="text-xs text-red-200 space-y-2">
                <p>המועד המחייב: {dateLabel(conflict.dueDate)} · מצב מתועד: {dateLabel(conflict.statusDate)}</p>
                <blockquote>{conflict.duty.anchor.quote}</blockquote><blockquote>{conflict.observation.anchor.quote}</blockquote>
                <button type="button" onClick={() => openDocument(conflict.duty.documentId, conflict.duty.anchor.page)}>פתח את מקור החובה</button>
                <button type="button" onClick={() => openDocument(conflict.observation.documentId, conflict.observation.anchor.page)}>פתח את מקור אי-הביצוע</button>
            </div>)}
            <details className="text-xs text-gray-300">
                <summary className="cursor-pointer">דרישות ומועדים שנמצאו במקורות</summary>
                <div className="mt-3 space-y-3">{history.timing.requirements.filter(item => item.clock !== 'UNSPECIFIED').map((item, index) => <div key={`timing-source-${index}`}>
                    <div>{dateLabel(item.date)} · {item.documentTitle}</div>
                    {item.scope === 'LETTER_RESPONSE' && <p className="text-blue-200 mt-1">מענה למכתב כולו; אינו מועד לחתימת MTM. {explainLetterResponseClock(item.anchor.quote)} ימי עבודה לא הומרו לימים קלנדריים.</p>}
                    <p className="text-amber-200 mt-1">{item.authority === 'SIGNED_AGREEMENT' ? 'התחייבות בהסכם חתום' : item.authority === 'APPLICABLE_DOCUMENT' ? 'חובה ומועד מתוך מסמך מחייב שתחולתו הוכחה' : item.authority === 'CONDITIONAL_CHOICE' ? 'תנאי לבחירת שיטה; אינו מוכיח איחור בחתימה' : 'הוראה או בקשת תגובה; לא הוכחה התחייבות חוזית למועד החתימה'}</p>
                    <blockquote className="mt-1 leading-6">{item.anchor.quote}</blockquote>
                    <button type="button" className="text-blue-300 mt-1" onClick={() => openDocument(item.documentId, item.anchor.page)}>פתח מסמך מקור</button>
                </div>)}</div>
            </details>
        </div>}
        <RadarRequirementReview value={history.requirementReview} projectId={history.projectId} openDocument={openDocument} />
        {history.ownerNotes?.map(note => <div key={note.id} className="p-3 rounded-xl border border-violet-400/20 bg-violet-500/5 text-sm">
            <div className="font-bold text-violet-200">עדכון בעל הפרויקט — בנפרד מהראיות במסמכים</div>
            <p className="text-gray-200 mt-2 leading-7">{note.text}</p>
            <p className="text-xs text-gray-400 mt-2">{note.aspect === 'SIGNATURE'
                ? 'לא צורף מסמך חתום או מועד חתימה. העדכון אינו משנה את המצב בתקופת המסמכים.'
                : 'הסבר בעל הפרויקט נשמר כהקשר לתהליך. הוא אינו מחליף את המסמכים או מוסיף מועד או אישור מתועדים.'}</p>
        </div>)}
        <details className="text-sm text-gray-300">
            <summary className="cursor-pointer">אירועים ומקורות ({history.events.length})</summary>
            <div className="mt-3 space-y-3">{history.events.map(event => <details key={event.id} className="p-3 rounded-xl border border-white/5">
                <summary className="cursor-pointer">{dateLabel(event.date)} · {aspects.find(aspect => aspect.key === event.aspect)?.label} · {states[event.state]}</summary>
                <p className="text-xs text-gray-400 mt-2">{event.documentTitle}</p>
                <blockquote className="mt-2 leading-7">{event.anchor.quote}</blockquote>
                {event.dateAnchor && <p className="text-xs text-gray-400 mt-2">מקור התאריך: {event.dateAnchor.quote}</p>}
                <button type="button" className="text-blue-300 text-xs mt-2" onClick={() => openDocument(event.anchor.documentId, event.anchor.page)}>פתח מסמך מקור</button>
            </details>)}</div>
        </details>
        {history.gaps.length > 0 && <details className="text-xs text-amber-200">
            <summary className="cursor-pointer">מקורות שלא מוכיחים החלטה סופית ({history.gaps.length})</summary>
            <ul className="mt-3 space-y-3">{history.gaps.map(gap => <li key={`${gap.documentId}:${gap.reason}`}>
                <div>{gap.documentTitle}</div>
                <p className="text-gray-400 mt-1">{gap.reason === 'SOURCE_NOT_READY'
                    ? 'אין אישור לקריאה מלאה של המקור. הוא לא שימש להוכחת החלטה.'
                    : 'אין תאריך מלא ומאומת במסמך. שם הקובץ אינו מוכיח מועד או הסכמה.'}</p>
                <button type="button" className="text-blue-300 mt-1" onClick={() => openDocument(gap.documentId, null)}>פתח מסמך מקור</button>
            </li>)}</ul>
        </details>}
    </section>;
}
