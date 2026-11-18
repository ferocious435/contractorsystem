import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { anchorSourceRange, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { parsePrintedBoqRows, type PrintedBoqRow } from './printed-boq-rows.ts';

export type ConsultantBoqDocument = DocumentSourceInput & {
    id: string; project_id: string; category?: string | null; doc_type?: string | null;
    created_at?: string | null; deleted_at?: string | null;
};
export type ConsultantBoqTopicSource = Pick<EvidenceAnchor, 'documentId' | 'quote' | 'start' | 'end'>;
export type ConsultantBoqBinding = {
    status: 'VERIFIED' | 'UNVERIFIED'; warnings: string[]; evidence: EvidenceAnchor[];
};
export type ConsultantBoqRevision = {
    date: string | null; datePurpose: 'DOCUMENT' | 'PRINTED' | 'UNKNOWN'; printedDate: string | null;
    dateEvidence: EvidenceAnchor | null; printedDateEvidence: EvidenceAnchor | null;
    designation: 'EXECUTION_BOQ' | 'CONTRACT_BOQ'; designationEvidence: EvidenceAnchor;
};
export type ConsultantBoqRow = Pick<PrintedBoqRow, 'itemCode' | 'scope' | 'quantity' | 'unit' | 'unitPrice' | 'total'
    | 'vatBasis' | 'ambiguousItemCode'> & EvidenceAnchor & {
    sourceHash: string | null; textHash: string | null; title: string;
    binding: ConsultantBoqBinding; revision: ConsultantBoqRevision; duplicateDocumentIds: string[];
};

// Search normalization is deliberately separate from stored text and all evidence offsets.
function searchText(value: string) {
    return normalizeEvidenceSource(value.replace(/(?<!\d)\d(?:[ \u200e\u200f]*\t+[ \u200e\u200f]*\d)+(?!\d)/gu,
        digits => digits.replace(/\s|[\u200e\u200f]/gu, '').split('').reverse().join(''))).toLowerCase();
}
const compact = (value: string) => searchText(value).replace(/\s+/gu, '');
const codes = (value: string) => [...value.matchAll(/(?<![\d.])\d{1,3}(?:\.\d{1,4}){2,4}(?!\d|\.\d)/gu)].map(m => m[0]);
const streets = (value: string) => [...searchText(value).matchAll(/(?:רחוב|רח')\s+([\p{L}\d]+)/gu)].map(m => m[1]);
function dimensions(value: string) {
    return [...searchText(value).matchAll(/(\d+(?:\.\d+)?)\s*מ["״]מ/gu)].map(m => Number(m[1]));
}
function matchesScope(scope: string, topic: string) {
    const row = compact(scope), query = compact(topic);
    const pipe = /צינור|צנר|pipes?/u;
    if (pipe.test(query)) {
        if (!pipe.test(row)) return false;
        // Jacking and supply are separate payable objects. Shafts and accessories do not become pipe rows.
        if (/פיר|שוחה|אביזר/u.test(row.slice(0, 35)) && !/^(?:דחיק|אספק|הנח|צינור)/u.test(row)) return false;
        if (/פיברגלס|grp|prg/u.test(query) && !/פיברגלס|grp|prg/u.test(row)) return false;
        if (/דחיק|tunneling|mtm/u.test(query) && !/דחיק|tunneling|אספק/u.test(row)) return false;
    } else {
        // For other objects require meaningful literal topic words, never item-code equality alone.
        const words = searchText(topic).match(/[\p{L}]{4,}/gu) || [];
        const meaningful = words.filter(word => !/^(?:מה|נאמר|הוחלט|תשלום|עבודות|בכתב|כמויות|במחיר|ברחוב|לגבי)$/u.test(word));
        if (!meaningful.some(word => row.includes(word))) return false;
    }
    const sizes = dimensions(topic);
    return !sizes.length || dimensions(scope).some(size => sizes.includes(size));
}
function lineEvidence(document: ConsultantBoqDocument, predicate: (line: string) => boolean) {
    for (const line of String(document.extracted_text || '').matchAll(/[^\r\n]+/gu)) {
        if (predicate(line[0])) return anchorSourceRange(document, line.index, line.index + line[0].length);
    }
    return null;
}
function revision(document: ConsultantBoqDocument): ConsultantBoqRevision | null {
    const body = String(document.extracted_text || ''), head = body.slice(0, 2500);
    if (/הצעת\s*מחיר|הצעת\s*הקבלן|contractor\s+(?:offer|proposal)/iu.test(searchText(head + ' ' + document.title))) return null;
    const designationEvidence = lineEvidence(document, line => /כתב\s*כמויות/u.test(searchText(line)));
    if (!designationEvidence || !/כמות/u.test(compact(head)) || !/מחיר/u.test(compact(head))) return null;
    const execution = /לביצוע/u.test(compact(head + ' ' + document.title));
    const contract = /חוז|contract/iu.test(head) && document.category === 'CONTRACT';
    if (!execution && !contract) return null;
    const authorityEvidence = execution ? lineEvidence(document, line => /לביצוע/u.test(compact(line))) :
        lineEvidence(document, line => /חוז|contract/iu.test(line));
    // The title is a hint, not a substitute for a quoted designation in the saved body.
    if (!authorityEvidence) return null;
    const datePattern = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/u;
    const printed = lineEvidence(document, line => datePattern.test(line) && /תאריך\s*הדפסה|הודפס|printed/iu.test(searchText(line)));
    const dated = lineEvidence(document, line => datePattern.test(line) && /תאריך\s*(?:המסמך|עדכון|מהדורה)|מהדורה|document\s*date|revision\s*date/iu.test(searchText(line))
        && !/הדפסה|הודפס|printed/iu.test(searchText(line)));
    return { date: dated?.quote.match(datePattern)?.[0] || null,
        datePurpose: dated ? 'DOCUMENT' : printed ? 'PRINTED' : 'UNKNOWN',
        printedDate: printed?.quote.match(datePattern)?.[0] || null,
        dateEvidence: dated || printed, printedDateEvidence: printed,
        designation: execution ? 'EXECUTION_BOQ' : 'CONTRACT_BOQ', designationEvidence: authorityEvidence };
}

/** Pure selection: no model, storage, network, date inference or financial writes. */
export function selectConsultantBoqRows(documents: ConsultantBoqDocument[], question: string,
    topicSources: ConsultantBoqTopicSource[]): ConsultantBoqRow[] {
    const active = documents.filter(document => !document.deleted_at);
    const grounded = topicSources.flatMap(source => {
        const document = active.find(document => document.id === source.documentId);
        if (!document || !assessDocumentSourceReadiness(document).canCompare
            || !Number.isInteger(source.start) || !Number.isInteger(source.end) || source.start < 0 || source.end <= source.start
            || String(document.extracted_text || '').slice(source.start, source.end) !== source.quote) return [];
        return [{ document, evidence: anchorSourceRange(document, source.start, source.end) }];
    });
    const projects = new Set((grounded.length ? grounded.map(source => source.document) : active).map(document => document.project_id));
    if (projects.size !== 1 || ![...projects][0]) return [];
    const projectId = [...projects][0];
    const topic = [question, ...grounded.map(source => source.evidence.quote)].join('\n');
    const requestedCodes = codes(topic), requestedStreets = streets(topic);
    const result: ConsultantBoqRow[] = [], originals = new Map<string, ConsultantBoqRow[]>();
    for (const document of active) {
        if (document.project_id !== projectId || !assessDocumentSourceReadiness(document).canCompare) continue;
        const info = revision(document);
        if (!info) continue;
        const documentStreets = streets(String(document.extracted_text || ''));
        if (requestedStreets.length && documentStreets.length
            && !documentStreets.some(street => requestedStreets.includes(street))) continue;
        const duplicateKey = document.content_hash || document.extracted_text_hash;
        const duplicate = duplicateKey ? originals.get(duplicateKey) : undefined;
        if (duplicate) { for (const row of duplicate) row.duplicateDocumentIds.push(document.id); continue; }
        const selected: ConsultantBoqRow[] = [];
        for (const row of parsePrintedBoqRows(String(document.extracted_text || ''))) {
            if (!row.arithmeticVerified || (requestedCodes.length && !requestedCodes.includes(row.itemCode))
                || !matchesScope(row.quote, topic)) continue;
            const rowStreets = streets(row.quote);
            if (requestedStreets.length && rowStreets.length && !rowStreets.some(street => requestedStreets.includes(street))) continue;
            const evidence = anchorSourceRange(document, row.start, row.end);
            const verified = requestedStreets.length > 0 && rowStreets.some(street => requestedStreets.includes(street));
            selected.push({ ...evidence, itemCode: row.itemCode, scope: row.scope, quantity: row.quantity,
                unit: row.unit, unitPrice: row.unitPrice, total: row.total, vatBasis: row.vatBasis,
                ambiguousItemCode: row.ambiguousItemCode, documentId: document.id,
                sourceHash: document.content_hash || null, textHash: document.extracted_text_hash || null,
                title: document.title || '', revision: info, duplicateDocumentIds: [],
                binding: { status: verified ? 'VERIFIED' : 'UNVERIFIED',
                    warnings: verified ? [] : ['יש לאמת שהסעיף מתייחס למקטע המבוקש; התאמת העבודה אינה מוכיחה שיוך למקטע.'],
                    evidence: verified ? [evidence] : [] } });
        }
        if (duplicateKey && selected.length) originals.set(duplicateKey, selected);
        result.push(...selected);
    }
    return result;
}
