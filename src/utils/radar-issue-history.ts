import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { findEvidenceAnchor, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';

export type IssueAspect = 'METHOD' | 'SIGNATURE' | 'PRICE';
export type IssueState = 'UNKNOWN' | 'PROPOSED' | 'PENDING' | 'CONDITIONAL' | 'APPROVED'
    | 'NOT_SIGNED' | 'SIGNED' | 'REFUSED' | 'AGREED' | 'DISPUTED';
export type IssueHistoryDocument = DocumentSourceInput & { id: string; category?: string | null };
export type IssueHistoryEvent = {
    id: string; aspect: IssueAspect; state: IssueState; date: string | null;
    dateSource: 'CONTENT' | 'FILENAME' | 'UNKNOWN'; dateAnchor: EvidenceAnchor | null;
    anchor: EvidenceAnchor; documentTitle: string; origin: 'DOCUMENT'; location: string | null;
};
export type IssueOwnerNote = {
    id: string; aspect: IssueAspect; state: IssueState; text: string; date: string | null;
    origin: 'OWNER_NOTE';
};
export type IssueHistoryInput = {
    issue: { subject: string; location: string }; documents: IssueHistoryDocument[];
    events?: IssueHistoryEvent[]; ownerNotes?: IssueOwnerNote[]; asOf: string;
};
export type IssueHistoryAssessment = ReturnType<typeof buildIssueHistory>;

export const ISSUE_HISTORY_VERSION = 'aspect-history-v1';
export const MTM_ISSUE = { subject: 'MTM', location: 'יהלום' };
export const ISSUE_ASPECTS: IssueAspect[] = ['METHOD', 'SIGNATURE', 'PRICE'];
const MTM = /\bM\s*T\s*M\b|מ\s*י\s*ק\s*ר\s*ו[\s־-]*ט\s*א?\s*נ\s*ל\s*י?\s*נ\s*ג/iu;
export function isMtmIssueText(text: string) { return MTM.test(text); }
const DATE = '(\\d{1,2})[./-](\\d{1,2})[./-](\\d{2,4})';

function calendarDate(match: RegExpMatchArray) {
    const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
    const month = Number(match[2]), day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? date.toISOString().slice(0, 10) : null;
}

// Only the document's own date, with its identifying words, can date an event.
// Referenced letters, deadlines, upload dates and filenames never supply authority.
export function documentEventDate(document: IssueHistoryDocument) {
    // Date context is the header, not the entire contract and quoted attachments.
    // This prefix is only a lookup view: the saved full source is never shortened.
    const header = String(document.extracted_text || '').slice(0, 6_000);
    const headerDocument = { id: document.id, extracted_text: header };
    for (const line of header.split(/\r?\n/).slice(0, 16)) {
        const match = line.trim().match(new RegExp(`^(?:(?:תאריך|Date)\\s*[:：]\\s*)?${DATE}\\s*$`, 'iu'));
        if (!match) continue;
        const date = calendarDate(match), anchor = findEvidenceAnchor(headerDocument, match[0].trim());
        if (date && anchor) return { date, dateSource: 'CONTENT' as const, dateAnchor: anchor };
    }
    const text = normalizeEvidenceSource(header);
    const patterns = [
        new RegExp(`נכון למועד מכתבנו זה[, :]*${DATE}`, 'u'),
        new RegExp(`תאריך (?:הישיבה|הדיון)[^\\d]{0,160}${DATE}`, 'u'),
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const date = calendarDate(match);
        const anchor = findEvidenceAnchor(headerDocument, match[0]);
        if (date && anchor) return { date, dateSource: 'CONTENT' as const, dateAnchor: anchor };
    }
    return { date: null, dateSource: 'UNKNOWN' as const, dateAnchor: null };
}

export function issueAspectsInText(text: string): IssueAspect[] {
    const aspects: IssueAspect[] = [];
    if (/מחיר|תמורה|תשלום|עלו[תי]|כתב הכמויות|price|payment|cost/iu.test(text)) aspects.push('PRICE');
    if (/חתימ|חתמת|נחתם|signed|signature/iu.test(text)) aspects.push('SIGNATURE');
    if (aspects.length === 0 || /אישור עקרוני|אושר לביצוע|אין לקבלן אישור|שיטת.{0,30}(?:אושר|יאושר)/u.test(text)) aspects.push('METHOD');
    return aspects;
}

function methodState(text: string): IssueState {
    if (/אישור עקרוני|בכפוף|בתנאי|בתנאים|עד לחתימ|לאחר חתימ|אין לקבלן אישור|ככל שהקבלן מעוניין|subject to|conditional/iu.test(text)) return 'CONDITIONAL';
    if (/טרם|לא אושר|יאושר|נדרש|pending|not approved|will be/iu.test(text)) return 'PENDING';
    if (/(?:\bMTM\b(?:\s+ברחוב\s+[\u0590-\u05ff]+)?|השיטה|שיטת הביצוע|שיטת הקידוח)(?:\s+(?:כבר|כעת|זו|הנ"ל))?\s*[:–-]?\s*(?:אושר(?:ה|ו)?|מאושר(?:ת)?|approved)/iu.test(text)) return 'APPROVED';
    return 'PROPOSED';
}

function signatureState(text: string): IssueState {
    // A generic heading such as "refusal to cooperate" must not become refusal to sign.
    if (/(?:סירב|מסרב|סירוב)\s+(?:לחתום|לחתימה)|refused to sign/iu.test(text)) return 'REFUSED';
    if (/טרם\s+(?:נחתם|חתמתם|חתם|נחתמה)|לא\s+(?:נחתם|נחתמה|חתם|חתמתם)|לא התקבלה חתימ|not (?:yet )?signed/iu.test(text)) return 'NOT_SIGNED';
    if (/_{3,}|עד לחתימ|לאחר חתימ|נספח לחתימה|הנספח לחתימה|יעביר חתום|דרוש.{0,20}חתימ|להשלים.{0,30}חתימ|will.{0,20}sign/iu.test(text)) return 'PENDING';
    if (/נחתם על ידי שני הצדדים|נחתמה על ידי שני הצדדים|חתום על ידי שני הצדדים|signed by both/iu.test(text)) return 'SIGNED';
    return 'UNKNOWN';
}

function priceState(text: string): IssueState {
    if (/מחלוקת|אין הסכמה|disputed/iu.test(text)) return 'DISPUTED';
    if (/טרם אושר|לא אושר|טרם סוכם|לא סוכם|(?:לא הגיש|לא נמסר) ניתוח מחיר|not approved|pending/iu.test(text)) return 'PENDING';
    if (/(?:מחיר|תמורה|תשלום).{0,80}(?:אושר|סוכם|הוסכם).{0,50}(?:בין הצדדים|שני הצדדים)|price.{0,50}agreed by both/iu.test(text)) return 'AGREED';
    return 'PROPOSED';
}

export function issueEvidenceParagraphs(document: IssueHistoryDocument) {
    const source = String(document.extracted_text || '');
    // Keep a complete bullet/paragraph, including its conditions and negatives.
    // Large protocol table cells contain several independent subject bullets.
    const lines = source.split(/\r?\n+/u);
    const paragraphs: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        let text = lines[index];
        // A subject heading followed by its bullets is one evidenced passage.
        if (isMtmIssueText(text) && /:\s*$/u.test(text)) {
            while (index + 1 < lines.length && /^\s*[-•]\s/u.test(lines[index + 1])) text += `\n${lines[++index]}`;
            paragraphs.push(normalizeEvidenceSource(text));
        } else paragraphs.push(...text.split(/(?=\s[-•]\s)|\s+(?=(?:[\u0590-\u05ff״"׳]+\s+){0,3}[\u0590-\u05ff״"׳]+\s+[–—]\s)/u)
            .map(value => normalizeEvidenceSource(value)));
    }
    return paragraphs.filter(text => text && !/^\|?[\s|:-]+$/u.test(text));
}

function exactAnchor(document: IssueHistoryDocument, anchor: EvidenceAnchor | null) {
    return anchor && anchor.documentId === document.id && Number.isInteger(anchor.start) && anchor.start >= 0
        && anchor.end > anchor.start && String(document.extracted_text || '').slice(anchor.start, anchor.end) === anchor.quote;
}

export function buildIssueHistory(input: IssueHistoryInput) {
    const documents = new Map(input.documents.map(document => [document.id, document]));
    const eventDates = new Map(input.documents.map(document => [document.id, documentEventDate(document)]));
    const gaps: { documentId: string; documentTitle: string; reason: string }[] = [];
    const candidates: IssueHistoryEvent[] = [...(input.events || [])];
    for (const document of input.documents) {
        const body = String(document.extracted_text || '');
        if (!isMtmIssueText(body)) continue;
        if (!assessDocumentSourceReadiness(document).canCompare) {
            gaps.push({ documentId: document.id, documentTitle: document.title || '', reason: 'SOURCE_NOT_READY' }); continue;
        }
        const date = eventDates.get(document.id)!;
        const isAnnex = /נספח לחוזה התקשרות/u.test(normalizeEvidenceSource(body).slice(0, 150)) && isMtmIssueText(body);
        const documentLocation = body.includes(input.issue.location) ? input.issue.location : null;
        for (const paragraph of issueEvidenceParagraphs(document)) {
            if (!isMtmIssueText(paragraph) && !(isAnnex && /תמורה|מחיר|שנחתם|על החתום/u.test(paragraph))) continue;
            const street = paragraph.match(/(?:ברחוב|רחוב)\s+([\p{L}״"'-]+)/u)?.[1];
            if (street && street !== input.issue.location) continue;
            const anchor = findEvidenceAnchor(document, paragraph);
            if (!anchor) continue;
            const aspects = issueAspectsInText(paragraph);
            if (isAnnex && /שנחתם.*_{3,}/u.test(paragraph)) aspects.splice(0, aspects.length, 'SIGNATURE');
            for (const aspect of aspects) {
                let state = aspect === 'METHOD' ? methodState(paragraph)
                    : aspect === 'SIGNATURE' ? signatureState(paragraph) : priceState(paragraph);
                if (isAnnex && aspect === 'SIGNATURE' && /_{3,}/u.test(paragraph)) state = 'UNKNOWN';
                // An unexecuted form contains proposals, even if its boilerplate says "agreed".
                if (isAnnex && /_{3,}/u.test(body) && ['APPROVED', 'AGREED', 'SIGNED'].includes(state)) state = 'PROPOSED';
                candidates.push({ id: `${document.id}:${anchor.start}:${aspect}`, aspect, state, ...date,
                    anchor, documentTitle: document.title || '', origin: 'DOCUMENT', location: street || documentLocation });
            }
        }
    }
    const events = [...new Map(candidates.filter(event => {
        const document = documents.get(event.anchor?.documentId);
        if (!document || !assessDocumentSourceReadiness(document).canCompare || !exactAnchor(document, event.anchor)) return false;
        if (event.location && event.location !== input.issue.location) return false;
        if (event.date !== null && (event.dateSource !== 'CONTENT' || !exactAnchor(document, event.dateAnchor)
            || eventDates.get(document.id)?.date !== event.date)) {
            gaps.push({ documentId: document.id, documentTitle: document.title || '', reason: 'EVENT_DATE_UNCONFIRMED' }); return false;
        }
        if (!event.date) gaps.push({ documentId: document.id, documentTitle: document.title || '', reason: 'EVENT_DATE_UNCONFIRMED' });
        return true;
    }).map(event => [event.id, event])).values()]
        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
    const aspects = {} as Record<IssueAspect, { state: IssueState; date: string | null; eventIds: string[] }>;
    for (const aspect of ISSUE_ASPECTS) {
        const dated = events.filter(event => event.aspect === aspect && event.date && event.date <= input.asOf);
        const latestDate = dated.at(-1)?.date || null;
        const latest = dated.filter(event => event.date === latestDate);
        const states = new Set(latest.map(event => event.state));
        // Different positions on the same day are not ordered by upload or row order.
        const opposing = (states.has('AGREED') && (states.has('PENDING') || states.has('DISPUTED')))
            || (states.has('SIGNED') && (states.has('NOT_SIGNED') || states.has('REFUSED')))
            || (states.has('APPROVED') && (states.has('PENDING') || states.has('CONDITIONAL')));
        const pendingOrder: IssueState[] = ['DISPUTED', 'REFUSED', 'NOT_SIGNED', 'PENDING', 'CONDITIONAL', 'AGREED', 'SIGNED', 'APPROVED', 'PROPOSED', 'UNKNOWN'];
        const state = opposing ? 'DISPUTED' : pendingOrder.find(value => states.has(value))
            || (events.some(event => event.aspect === aspect && !event.date && event.state === 'PROPOSED') ? 'PROPOSED' : 'UNKNOWN');
        aspects[aspect] = { state, date: latestDate, eventIds: latest.map(event => event.id) };
    }
    const observed = ISSUE_ASPECTS.filter(aspect => events.some(event => event.aspect === aspect));
    const closed = observed.length > 0 && observed.every(aspect => ['APPROVED', 'SIGNED', 'AGREED'].includes(aspects[aspect].state));
    return { version: ISSUE_HISTORY_VERSION, issue: input.issue, asOf: input.asOf,
        evidenceThrough: events.filter(event => event.date && event.date <= input.asOf).at(-1)?.date || null,
        nextEffectiveDate: events.find(event => event.date && event.date > input.asOf)?.date || null,
        aspects, events, ownerNotes: [...(input.ownerNotes || [])].map(note => ({ ...note, origin: 'OWNER_NOTE' as const }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        gaps: [...new Map(gaps.map(gap => [`${gap.documentId}:${gap.reason}`, gap])).values()]
            .sort((a, b) => a.documentId.localeCompare(b.documentId) || a.reason.localeCompare(b.reason)), closed };
}
