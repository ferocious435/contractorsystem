import { getEvidenceDisplayStatus, evidenceStatusLabel, evidenceReasonLabel } from '@/utils/radar-evidence-status';

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function text(value: unknown) { return typeof value === 'string' ? value : ''; }
export function RadarFindingAssessment({ value }: { value: unknown }) {
    const evidence = record(value), semantic = record(evidence.semantic_assessment), review = record(evidence.finding_review);
    const work = record(semantic.work), baseline = record(semantic.baseline), history = record(evidence.issue_history);
    const verification = record(evidence.source_verification);
    const sourceContext = record(review.sourceContext);
    const reasons = [...new Set([...(Array.isArray(review.reasons) ? review.reasons : []),
        ...(Array.isArray(semantic.reasons) ? semantic.reasons : [])].filter((r): r is string => typeof r === 'string').map(evidenceReasonLabel))];
    const kind: Record<string,string> = { CONTRADICTION:'דרישות שאינן מתיישבות', KNOWN_CHANGE:'שינוי מתועד לבירור',
        EVENT:'אירוע מתועד', NEEDS_VERIFICATION:'השוואה שדורשת ביסוס', NO_CONFLICT:'לא הוכחה סתירה בהשוואה זו' };
    const date = text(history.evidenceThrough) || text(review.evidenceDate);
    return <section aria-label="סוג המסקנה ובסיסה" className="ti-radar-section" data-evidence-status={getEvidenceDisplayStatus(evidence)}>
        <h4 className="text-sm font-bold text-amber-200">סוג המסקנה ובסיסה</h4>
        <p className="text-sm text-gray-200">{kind[text(semantic.resultType)] || 'טרם בוצעה הערכה של משמעות ההשוואה'} · {evidenceStatusLabel(getEvidenceDisplayStatus(evidence))}</p>
        <p className="text-xs text-gray-400">{date ? `מצב לפי המסמכים עד ${date.split('-').reverse().join('.')}` : 'לא נמצא תאריך מלא ומאומת למצב המתואר.'}</p>
        <p className="text-xs text-gray-400">{verification.work_quote_matched === true
            ? `המובאה ממסמך הביצוע נמצאה במקור.${verification.contract_quote_matched === true ? ' גם המובאה מהבסיס נמצאה במקור.' : ''} התאמת מובאות אינה מוכיחה לבדה סתירה.`
            : 'המובאה ממסמך הביצוע עדיין אינה מאומתת במקור המשויך.'}</p>
        {reasons.length > 0 && <ul className="list-disc list-inside text-sm text-amber-100 space-y-2">{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {(text(work.statement) || text(baseline.statement)) && <details className="text-sm text-gray-300">
            <summary className="cursor-pointer">הדרישות וההקשר שנבדקו</summary>
            {sourceContext.selectionReason === 'existing_record_source_links' && <p className="mt-3 text-xs text-gray-400">
                נבדקו המקורות שכבר קושרו לכרטיס, לפי הטקסטים השמורים שלהם.
            </p>}
            {sourceContext.originalModelContextRecorded === false && <p className="mt-2 text-xs text-amber-100">
                ההקשר מהבדיקה המקורית לא נשמר. ההקשר המוצג כאן שייך לבדיקה הנוכחית.
            </p>}
            {text(work.statement) && <p className="mt-3 leading-7">מסמך הביצוע: {text(work.statement)}</p>}
            {text(baseline.statement) && <p className="mt-3 leading-7">הבסיס להשוואה: {text(baseline.statement)}</p>}
            {[['מקום',work.location],['הצד המחויב',work.party],['תנאי',work.condition],['תקופה',work.period]].map(([label,val]) => text(val)
                ? <p key={String(label)} className="mt-2 text-xs">{text(label)}: {text(val)}</p> : null)}
        </details>}
    </section>;
}
