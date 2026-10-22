import { isTechnicalRadarExclusion } from './radar-review-disposition.ts';

export type EvidenceDisplayStatus = 'SOURCE_VERIFIED' | 'QUOTES_REQUIRE_SOURCE_CHECK' | 'INCOMPLETE'
    | 'MATCHED_QUOTES_REQUIRE_ASSESSMENT' | 'REQUIRES_REVIEW' | 'NO_CONFLICT';
function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function getEvidenceDisplayStatus(evidence: unknown): EvidenceDisplayStatus {
    const record = asRecord(evidence);
    if (!record) return 'INCOMPLETE';
    if (typeof record.work_quote !== 'string' || !record.work_quote.trim()) return 'INCOMPLETE';
    const verification = asRecord(record.source_verification);
    const quotesMatched = typeof record.contract_quote === 'string' && Boolean(record.contract_quote.trim())
        && verification?.contract_quote_matched === true && verification?.work_quote_matched === true;
    const semantic = asRecord(record.semantic_assessment);
    if (semantic?.version === 'evidence-relation-v1') {
        if (verification?.source_reading_complete !== true || verification?.comparison_context_complete !== true) return 'REQUIRES_REVIEW';
        if (semantic.resultType === 'NO_CONFLICT' && ['COMPATIBLE','DIFFERENT_SUBJECT'].includes(String(semantic.relation))) return 'NO_CONFLICT';
        return !isTechnicalRadarExclusion({ evidence_data: record }) && record.evidence_status === 'VERIFIED' && quotesMatched
            && verification?.quality_gate_passed === true && verification?.source_reading_complete === true
            && verification?.comparison_context_complete === true
            && semantic.relation === 'INCOMPATIBLE' && semantic.resultType === 'CONTRADICTION'
            ? 'SOURCE_VERIFIED' : 'REQUIRES_REVIEW';
    }
    if (quotesMatched) return 'MATCHED_QUOTES_REQUIRE_ASSESSMENT';
    return record.contract_quote && record.work_quote ? 'QUOTES_REQUIRE_SOURCE_CHECK' : 'INCOMPLETE';
}
export function evidenceStatusLabel(status: EvidenceDisplayStatus) {
    return { SOURCE_VERIFIED: 'סתירה מבוססת בין הדרישות', QUOTES_REQUIRE_SOURCE_CHECK: 'יש מובאות · נדרש אימות במקור',
        INCOMPLETE: 'חסר בסיס מסמכי מלא', MATCHED_QUOTES_REQUIRE_ASSESSMENT: 'המובאות נמצאו · משמעות ההשוואה טרם נבדקה',
        REQUIRES_REVIEW: 'המסקנה דורשת בירור', NO_CONFLICT: 'ההשוואה אינה מוכיחה סתירה' }[status];
}
export function evidenceReasonLabel(reason: string) {
    const labels: Record<string,string> = {
        incompatible_requirements: 'נמצאו דרישות שאי אפשר לקיים יחד באותו היקף עבודה.',
        documented_replacement_requires_scope_and_approval_check: 'המקור מתעד שינוי; יש לבדוק בנפרד את היקפו, אישורו והמחיר.',
        completion_deadline_basis_not_established: 'בסיס מועד ההשלמה לא הוכח; נדרשת בדיקת ההסכם הרלוונטי.',
        pricing_or_measurement_is_not_a_conflicting_instruction: 'מחירון או שיטת מדידה אינם הוראה סותרת לביצוע.',
        different_work_subjects: 'המקורות עוסקים בעבודות או בנושאים שונים.',
        different_comparison_attributes: 'הנתונים מתארים מאפיינים שונים ולכן אינם מוכיחים סתירה.',
        same_approval_workflow: 'הדרישות תואמות את אותו תהליך אישור.',
        complementary_schedule_obligations: 'הגשת לוח זמנים ועדכונו הן חובות משלימות.',
        work_quote_not_found: 'המובאה לא נמצאה במסמך הביצוע שאליו היא משויכת.',
        contract_quote_not_found: 'המובאה לא נמצאה במקור החוזי שאליו היא משויכת.',
        contract_document_not_found: 'המקור החוזי המשויך אינו זמין לאימות.',
        work_document_not_found: 'מסמך הביצוע המשויך אינו זמין לאימות.',
        source_reading_incomplete: 'קריאת אחד המקורות או גרסתו עדיין אינן מאומתות.',
        comparison_context_incomplete: 'לא נכלל מלוא ההקשר הנדרש להשוואה.',
        subject_or_attribute_not_established: 'לא הוכח שהדרישות עוסקות באותה עבודה ובאותו מאפיין.',
        operative_requirements_not_established: 'לא הוכחו שתי דרישות מחייבות לביצוע.',
        incompatibility_not_established: 'לא הוכח שאי אפשר לקיים את הדרישות יחד.',
        context_dimension_not_established: 'ההתאמה במקום, בצדדים, בתנאים או בתקופה טרם הוכחה.',
        semantic_field_not_grounded: 'אחד מפרטי ההשוואה אינו מבוסס על הטקסט במקור.',
        primary_source_requires_review_history_retained: 'המקור הנוכחי דורש בירור; הנושא נשאר נגיש עם האירועים, המקורות והחישובים שנאספו קודם.',
    };
    return labels[reason] || 'נדרש בירור נוסף של משמעות הדרישה והקשר בין המקורות.';
}
