import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';

type ReviewDocument = DocumentSourceInput & { id: string; title?: string | null; category?: string | null };
type DeadlineSource = { documentId: string; title: string; role: 'CLAIM' | 'BASIS_CANDIDATE'; date: string;
    scope: 'WATER_AND_SEWER' | 'PROJECT' | 'UNSPECIFIED'; anchor: EvidenceAnchor };
export type CompletionDeadlineReview = {
    version: 'referenced-completion-deadline-v1';
    status: 'BASIS_LOCATED' | 'BASIS_NOT_FOUND_IN_READABLE_SOURCES' | 'NO_REFERENCED_DEADLINE';
    documentsChecked: number; references: DeadlineSource[]; agreementSources: DeadlineSource[];
    referenceDates: string[]; referencesDisagree: boolean; unreadDocumentIds: string[];
    provesBreach: false; summary: string;
};

const ADVANCE_REFERENCE = /(?:הסכם\s+(?:ה)?מקדמה|תנאי\s+קבלת\s+(?:ה)?מקדמה|(?:קבלת|חתימתך על)\s+(?:ה)?מקדמה)/gu;
const COMPLETION = /להשל[ימ]|השלמת|מועד\s+סיום|סיום\s+(?:כלל|כל|העבודות)/u;

export function mayReferenceAdvanceDeadline(document: DocumentSourceInput) {
    // A fast conservative prefilter avoids building per-character source maps
    // for unrelated specifications. Preserve spaced/OCR Hebrew spellings.
    return /מ[\s\u200e\u200f]*ק[\s\u200e\u200f]*ד[\s\u200e\u200f]*מ[\s\u200e\u200f]*ה/u
        .test(`${document.title || ''} ${document.extracted_text || ''}`.normalize('NFKC'));
}

function explicitDate(value: string) {
    const match = value.match(/(?:עד\s+(?:ל)?(?:תאריך|יום)|לא יאוחר מיום|מועד סיום מעודכן\s*\(?)\s*(\d{1,2})[./](\d{1,2})[./](\d{2,4})/u);
    if (!match) return null;
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
    return date.getUTCFullYear() === year && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[1])
        ? date.toISOString().slice(0, 10) : null;
}

function deadlineScope(passage: string, date: string): DeadlineSource['scope'] {
    const clause = passage.split(/(?<=[^\d])\.(?=\s|$)|;\s*/u)
        .find(part => COMPLETION.test(part) && explicitDate(part) === date) || '';
    const waterAndSewer = /מים\s+(?:ו)?ביוב|המים\s+והביוב|עבודות\s+התאגיד/u.test(clause);
    const project = /ביצוע\s+הפרויקט|כלל\s+הפרויקט/u.test(clause);
    return waterAndSewer === project ? 'UNSPECIFIED' : waterAndSewer ? 'WATER_AND_SEWER' : 'PROJECT';
}

export function reviewCompletionDeadlineBasis(input: { currentWorkDocument: ReviewDocument; documents: ReviewDocument[] }): CompletionDeadlineReview {
    const documents = [...new Map(input.documents.map(document => [document.id, document])).values()];
    const references: DeadlineSource[] = [];
    const agreementSources: DeadlineSource[] = [];
    const unreadDocumentIds: string[] = [];
    const current = normalizeEvidenceSource(String(input.currentWorkDocument.extracted_text || ''));
    const applicable = /מקדמה/u.test(current) && COMPLETION.test(current);
    if (applicable) for (const document of documents) {
        if (!mayReferenceAdvanceDeadline(document)) continue;
        const source = normalizeEvidenceSource(String(document.extracted_text || ''));
        const title = normalizeEvidenceSource(String(document.title || ''));
        const primaryAgreement = /הסכם\s+(?:ה)?מקדמה/u.test(title) && ['CONTRACT', 'CHANGE_ORDER'].includes(String(document.category));
        const hits = [...source.matchAll(ADVANCE_REFERENCE)];
        if (!hits.length && !primaryAgreement) continue;
        if (!assessDocumentSourceReadiness(document).canCompare) { unreadDocumentIds.push(document.id); continue; }
        const passages = primaryAgreement ? [source] : hits.map(hit => source.slice(Math.max(0, hit.index - 160), hit.index + 500));
        for (const passage of passages) {
            if (!COMPLETION.test(passage)) continue;
            const date = explicitDate(passage);
            const anchor = date ? findEvidenceAnchor(document, passage) : null;
            if (!date || !anchor) continue;
            const collection = primaryAgreement ? agreementSources : references;
            if (collection.some(item => item.documentId === document.id && item.date === date)) continue;
            collection.push({ documentId: document.id, title: String(document.title || ''),
                role: primaryAgreement ? 'BASIS_CANDIDATE' : 'CLAIM', date,
                scope: deadlineScope(passage, date), anchor });
        }
    }
    const referenceDates = [...new Set(references.map(item => item.date))].sort();
    const status: CompletionDeadlineReview['status'] = !applicable ? 'NO_REFERENCED_DEADLINE'
        : agreementSources.length ? 'BASIS_LOCATED' : 'BASIS_NOT_FOUND_IN_READABLE_SOURCES';
    const summary = status === 'BASIS_LOCATED'
        ? 'אותר מקור של הסכם המקדמה. יש לבדוק את תחולתו והיקף העבודות לפני קביעת הפרה; ההתכתבות לבדה אינה מוכיחה אותה.'
        : status === 'NO_REFERENCED_DEADLINE' ? 'לא זוהתה הפניה למועד השלמה לפי הסכם מקדמה במסמך הנבדק.'
            : `נבדקו ${documents.length} מסמכים שמורים. נמצאו ${references.length} מקורות קריאים המתייחסים למועד ${referenceDates.join(', ') || 'שאינו מפורש'}. הסכם המקדמה עצמו לא אותר במקורות הקריאים. זו טענה בהתכתבות; לא הוכחה סתירה לתקופת החוזה הכוללת או הפרה.`;
    return { version: 'referenced-completion-deadline-v1', status, documentsChecked: documents.length,
        references, agreementSources, referenceDates, referencesDisagree: referenceDates.length > 1,
        unreadDocumentIds, provesBreach: false, summary };
}
