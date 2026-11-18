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
    identifier?: { boq: string; edition: string; evidence: EvidenceAnchor } | null;
    conflictingDateEvidence?: EvidenceAnchor[];
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
/** Only return a complete name bounded by punctuation, end-of-line or a known clause.
 * An unparsed continuation stays unknown and can never verify a site. */
function streets(value: string): string[] {
    const names: string[] = [];
    const clause = /\s+(?=(?:ב?קוטר|בעיר|בקרית|בקריית|יש|לפי|בהתאם|דחיקת|אספקת|הנחת|הקמת|לבצע|מה|האם)(?:\s|$))/u;
    for (const line of value.split(/\r?\n/u).map(searchText)) {
        for (const match of line.matchAll(/(?:^|[^\p{L}\d])(?:ב|ל|מ)?(?:רחוב|רח['׳])\s+/gu)) {
            const tail = line.slice(match.index + match[0].length);
            const quoted = tail.match(/^["״]([^"״]+)["״]/u);
            if (!quoted && /\.{2,}|…/u.test(tail.split(clause)[0])) continue;
            const name = (quoted?.[1] || tail.split(/[?!,;:()[\]]|\.(?!\d)/u)[0].split(clause)[0]).trim();
            const words = name.split(/\s+/u);
            if (!name || words.length > 4 || !/^[\p{L}\d]+(?:[ \-־][\p{L}\d]+)*$/u.test(name)) continue;
            names.push(name);
        }
    }
    return names;
}

const constructionObjects = [
    ['PIPE', /צינור(?:ות)?|צנר(?:ת)?|pipes?/u],
    ['WALL', /קירות|קיר|walls?/u],
    ['BUILDING', /מבנים|מבנה|בניין|בנין|buildings?/u],
    ['SHAFT', /פירים|פיר|shafts?/u],
    ['MANHOLE', /שוחות|שוחה|manholes?/u],
    ['ROAD', /כבישים|כביש|roads?/u],
    ['SIDEWALK', /מדרכות|מדרכה|sidewalks?/u],
    ['FLOOR', /רצפות|רצפה|floors?/u],
    ['COLUMN', /עמודים|עמוד|columns?/u],
] as const;
function constructionObject(value: string) {
    const normalized = compact(value);
    return constructionObjects.map(([kind, pattern]) => ({ kind, index: normalized.search(pattern) }))
        .filter(match => match.index >= 0).sort((left, right) => left.index - right.index)[0]?.kind || null;
}
const materials = [
    ['GRP', /פיברגלס|grp|prg|fiberglass|fibreglass/u],
    ['STEEL', /פלדה|steel/u],
    ['CONCRETE', /בטון|concrete/u],
    ['PVC', /pvc/u],
    ['PE', /פוליאתילן|polyethylene|hdpe/u],
    ['DUCTILE_IRON', /ברזלדוקטילי|יציקהדוקטילית|ductileiron/u],
] as const;
function explicitMaterials(value: string) {
    const normalized = compact(value);
    return materials.filter(([, pattern]) => pattern.test(normalized)).map(([material]) => material);
}
function dimensions(value: string) {
    return [...searchText(value).matchAll(/(\d+(?:\.\d+)?)\s*מ["״]מ/gu)].map(m => Number(m[1]));
}
function matchesScope(scope: string, topic: string) {
    const row = compact(scope), query = compact(topic);
    // The first printed description establishes the payable object. A later note about
    // pipes, for example, cannot turn a building or a shaft into a pipe-supply row.
    const rowObject = constructionObject(scope.split(/\r?\n/u)[0]);
    const queryObject = constructionObject(topic);
    if (!queryObject || queryObject !== rowObject) return false;
    const queryMaterials = explicitMaterials(topic), rowMaterials = explicitMaterials(scope);
    if (queryMaterials.length && !queryMaterials.every(material => rowMaterials.includes(material))) return false;
    if (queryObject === 'PIPE') {
        // Jacking and supply remain separate payable objects under the same pipe topic.
        if (/דחיק|tunneling|mtm/u.test(query) && !/דחיק|tunneling|אספק/u.test(row)) return false;
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
export function readConsultantBoqRevision(document: ConsultantBoqDocument): ConsultantBoqRevision | null {
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
    const dates = [...body.matchAll(/[^\r\n]+/gu)].filter(line => datePattern.test(line[0])
        && /תאריך\s*(?:המסמך|עדכון|מהדורה)|document\s*date|revision\s*date/iu.test(searchText(line[0]))
        && !/הדפסה|הודפס|printed/iu.test(searchText(line[0])))
        .map(line => anchorSourceRange(document, line.index, line.index + line[0].length));
    const conflictingDateEvidence = new Set(dates.map(anchor => anchor.quote.match(datePattern)?.[0])).size > 1 ? dates : [];
    const dated = conflictingDateEvidence.length ? null : dates[0];
    const identifierPattern = /^מספר כתב כמויות:\s*([\p{L}\d_-]+);\s*מהדורה:\s*([\p{L}\d_-]+)\s*$/u;
    const identifiers = [...body.matchAll(/[^\r\n]+/gu)].filter(line => identifierPattern.test(line[0]));
    const identifierEvidence = identifiers.length === 1 ? anchorSourceRange(document, identifiers[0].index,
        identifiers[0].index + identifiers[0][0].length) : null;
    const identifierMatch = identifierEvidence?.quote.match(identifierPattern);
    return { conflictingDateEvidence,
        identifier: identifierMatch && identifierEvidence ? { boq: identifierMatch[1], edition: identifierMatch[2], evidence: identifierEvidence } : null,
        date: dated?.quote.match(datePattern)?.[0] || null,
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
    // A broad historical packet can mention other materials, sizes and sections.
    // Explicit question constraints retain priority; unrelated history cannot turn
    // them into additional mandatory constraints on every payable row.
    const questionHasObject = !!constructionObject(question);
    const requestedCodes = codes(question).length ? codes(question) : questionHasObject ? [] : codes(topic);
    const requestedStreets = streets(question).length ? streets(question) : streets(topic);
    const scopeTopics = questionHasObject ? [question] : grounded.map(source=>question+'\n'+source.evidence.quote);
    const result: ConsultantBoqRow[] = [], originals = new Map<string, ConsultantBoqRow[]>();
    for (const document of active) {
        if (document.project_id !== projectId || !assessDocumentSourceReadiness(document).canCompare) continue;
        const info = readConsultantBoqRevision(document);
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
                || !scopeTopics.some(scopeTopic=>matchesScope(row.quote, scopeTopic))) continue;
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
