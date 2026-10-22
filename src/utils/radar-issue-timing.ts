import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { documentEventDate, isMtmIssueText, issueEvidenceParagraphs, type IssueHistoryDocument } from './radar-issue-history.ts';

type TimingAction = 'SIGN' | 'EXECUTE' | 'SUBMIT_PRICE' | 'APPROVE_PRICE' | 'APPROVE_METHOD' | 'RESPOND';
type TimingRequirement = {
    documentId: string; documentTitle: string; date: string | null; action: TimingAction;
    scope: 'MTM' | 'LETTER_RESPONSE';
    dueDate: string | null; clock: 'ABSOLUTE' | 'RELATIVE' | 'TIME_ONLY' | 'UNSPECIFIED';
    authority: 'SIGNED_AGREEMENT' | 'INSTRUCTION_OR_REQUEST' | 'CONDITIONAL_CHOICE'; anchor: EvidenceAnchor;
};
export type IssueTimingReview = ReturnType<typeof reviewIssueTiming>;
const openPatterns: Record<TimingAction, RegExp> = {
    SIGN: /טרם (?:נחתם|נחתמה|חתמתם|חתם)|לא (?:נחתם|נחתמה|חתם|חתמתם)|לא התקבלה חתימ/u,
    EXECUTE: /(?:טרם|לא) (?:בוצע|בוצעו|הושלם|הושלמו)/u,
    SUBMIT_PRICE: /(?:טרם|לא) (?:הגיש|הוגש|נמסר|הועבר) ניתוח מחיר/u,
    APPROVE_PRICE: /(?:מחיר|תמורה).{0,40}(?:טרם|לא) (?:אושר|סוכם|הוסכם)/u,
    APPROVE_METHOD: /(?:שיטה|שיטת|MTM).{0,45}(?:טרם|לא) אושר/u,
    RESPOND: /(?:טרם|לא) (?:נמסר|נמסרה|התקבל|התקבלה|ניתן|ניתנה) (?:מענה|תשובה|תגובה)/u,
};

function actions(text: string) {
    const result: TimingAction[] = [];
    if (/לחתום|להשלים.{0,20}חתימ|נדרש לחתימ/u.test(text)) result.push('SIGN');
    if (/(?:להגיש|להעביר|יגיש|יעביר).{0,25}ניתוח מחיר/u.test(text)) result.push('SUBMIT_PRICE');
    if (/(?:לאשר|יאשר).{0,20}(?:מחיר|תמורה)/u.test(text)) result.push('APPROVE_PRICE');
    if (/(?:לאשר|יאשר).{0,20}(?:שיטה|MTM)/u.test(text)) result.push('APPROVE_METHOD');
    if (/להשלים|לבצע|להתחיל/u.test(text) && !result.includes('SIGN')) result.push('EXECUTE');
    if (/(?:להעביר|יעביר|נבקש|להשיב).{0,35}(?:תשובה|תגובה|מענה|אישור מפורש)/u.test(text)) result.push('RESPOND');
    return result;
}

function deadline(text: string) {
    const date = text.match(/(?:עד (?:ליום|יום|לתאריך|תאריך)|לא יאוחר מיום)\s*(?:[\u0590-\u05ff]+\s+){0,2}(\d{1,2})[./](\d{1,2})[./](\d{2,4})/u);
    if (date) {
        const year = Number(date[3]) < 100 ? 2000 + Number(date[3]) : Number(date[3]);
        const value = new Date(Date.UTC(year, Number(date[2]) - 1, Number(date[1])));
        if (value.getUTCFullYear() === year && value.getUTCMonth() === Number(date[2]) - 1 && value.getUTCDate() === Number(date[1])) {
            return { dueDate: value.toISOString().slice(0, 10), clock: 'ABSOLUTE' as const };
        }
    }
    return { dueDate: null, clock: /(?:בתוך|תוך)\s+\d+\s+(?:ימי|ימים|שעות)/u.test(text) ? 'RELATIVE' as const
        : /עד (?:לשעה|השעה)\s*\d{1,2}:\d{2}/u.test(text) ? 'TIME_ONLY' as const : 'UNSPECIFIED' as const };
}

export function reviewIssueTiming(input: { issue: { subject: string; location: string }; documents: IssueHistoryDocument[]; asOf: string }) {
    const requirements: TimingRequirement[] = [];
    const observations: { documentId: string; documentTitle: string; date: string; text: string; anchor: EvidenceAnchor }[] = [];
    for (const document of input.documents) {
        const source = String(document.extracted_text || '');
        if (!isMtmIssueText(source) || !assessDocumentSourceReadiness(document).canCompare) continue;
        const date = documentEventDate(document).date;
        if (date && date > input.asOf) continue;
        const header = normalizeEvidenceSource(source).slice(0, 350);
        const category = String(document.category || '');
        // An employer's assertion that its annex is binding is not the executed agreement.
        const signedAgreement = ['CONTRACT', 'CHANGE_ORDER'].includes(category)
            && /(?:הסכם|חוזה|נספח).{0,100}(?:חתום|נחתם) על ידי שני הצדדים/u.test(header)
            && !/_{3,}|טרם נחתם|לא נחתם/u.test(source);
        for (const text of issueEvidenceParagraphs(document)) {
            const explicitMtm = isMtmIssueText(text);
            const letterReply = !explicitMtm && /(?:נבקש|נשמח).{0,25}תגובת|תגובתכם.{0,50}(?:בתוך|תוך)/u.test(text)
                && deadline(text).clock === 'RELATIVE';
            if (!explicitMtm && !letterReply) continue;
            const street = text.match(/(?:ברחוב|רחוב)\s+([\p{L}״"'-]+)/u)?.[1];
            if (street && street !== input.issue.location) continue;
            const anchor = findEvidenceAnchor(document, text);
            if (!anchor) continue;
            if (date && explicitMtm) observations.push({ documentId: document.id, documentTitle: document.title || '', date, text, anchor });
            const conditional = /ככל|אם לא|בכפוף|בתנאי|רשאי|רשאית/u.test(text);
            for (const action of letterReply ? ['RESPOND' as const] : actions(text)) requirements.push({ documentId: document.id, documentTitle: document.title || '',
                scope: letterReply ? 'LETTER_RESPONSE' : 'MTM',
                date, action, ...deadline(text), authority: conditional ? 'CONDITIONAL_CHOICE'
                    : signedAgreement ? 'SIGNED_AGREEMENT' : 'INSTRUCTION_OR_REQUEST', anchor });
        }
    }
    const confirmedConflicts: { action: TimingAction; dueDate: string; statusDate: string;
        duty: TimingRequirement; observation: typeof observations[number] }[] = [];
    for (const duty of requirements) {
        if (!duty.date || !duty.dueDate || duty.date > duty.dueDate || duty.authority !== 'SIGNED_AGREEMENT' || duty.scope !== 'MTM') continue;
        for (const observation of observations) {
            if (observation.date <= duty.dueDate || !openPatterns[duty.action].test(observation.text)) continue;
            // Confirm the same location in both passages before claiming a breach.
            if (!duty.anchor.quote.includes(input.issue.location) || !observation.text.includes(input.issue.location)) continue;
            confirmedConflicts.push({ action: duty.action, dueDate: duty.dueDate, statusDate: observation.date, duty, observation });
        }
    }
    requirements.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')
        || a.documentId.localeCompare(b.documentId) || a.anchor.start - b.anchor.start || a.action.localeCompare(b.action));
    confirmedConflicts.sort((a, b) => a.statusDate.localeCompare(b.statusDate) || a.action.localeCompare(b.action));
    return { status: confirmedConflicts.length ? 'PROVEN_TIMING_CONFLICT' as const : 'NO_PROVEN_TIMING_CONFLICT' as const,
        asOf: input.asOf, requirements, confirmedConflicts };
}
