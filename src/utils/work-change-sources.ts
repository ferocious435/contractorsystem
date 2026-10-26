import { assessDocumentSourceReadiness, type DocumentSourceInput } from './document-source-readiness.ts';
import { meaningfulRetrievalTerms, selectContractContext, type ContractContextSelection } from './contract-context-selection.ts';
import { anchorSourceRange, findEvidenceAnchor, type EvidenceAnchor } from './radar-evidence-assessment.ts';

export type WorkChangeDocument = DocumentSourceInput & {
    id: string; project_id: string | null; category?: string | null; doc_type?: string | null;
    storage_bucket?: string | null; extracted_text_hash?: string | null; processed_at?: string | null; deleted_at?: string | null;
};
export type WorkChangeFinding = {
    id: string; project_id: string; title?: string | null; description?: string | null; status?: string | null;
    source_execution_doc_id?: string | null; target_contract_doc_id?: string | null; evidence_data?: unknown;
};
export type WorkChangeSource = WorkChangeDocument & {
    title: string; role: 'PRIMARY' | 'RELATED' | 'CONTRACT';
    connection: { kind: 'PRIMARY' | 'DIRECT' | 'REFERENCE' | 'CANDIDATE'; evidence: EvidenceAnchor[] };
    selection: ContractContextSelection; readiness: ReturnType<typeof assessDocumentSourceReadiness>;
    referencedItemCodes?: string[];
};
export type WorkChangePacket = {
    findingId: string; projectId: string; title: string; query: string; primarySourceIds: string[];
    sources: WorkChangeSource[]; ownerNotes: Array<Record<string, unknown>>; limitations: string[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const canonicalCode = (value: string) => value.split('.').map(part => String(Number(part))).join('.');
function itemCodes(value: string) {
    return [...value.matchAll(/(?<![\d.])\d{1,3}(?:\.\d{1,4}){2,4}(?!\d|\.\d)/gu)]
        .map(match => ({ key: canonicalCode(match[0]), raw: match[0], index: match.index }));
}

/** Retrieval proposes sources. Neither a keyword match nor a reference grants contractual authority. */
export function buildWorkChangePacket(finding: WorkChangeFinding, supplied: WorkChangeDocument[]): WorkChangePacket {
    const documents = supplied.filter(doc => doc.project_id === finding.project_id && !doc.deleted_at);
    const evidence = record(finding.evidence_data);
    const primary = documents.find(doc => doc.id === finding.source_execution_doc_id);
    const query = [finding.title, evidence.work_quote || finding.description].filter(value => typeof value === 'string').join('\n');
    const terms = meaningfulRetrievalTerms(query);
    const locations = [...query.matchAll(/(?:ברחוב|רחוב|street)\s+([\p{L}\d"'״׳-]+)/giu)].map(match => match[1].toLowerCase());
    const locationTerms = new Set(['רחוב', 'ברחוב', 'street', ...locations]);
    const tokenSets = new Map(documents.map(doc => [doc.id, meaningfulRetrievalTerms(`${doc.title || ''}\n${doc.extracted_text || ''}`)]));
    const frequency = new Map([...terms].map(term => [term, documents.filter(doc => tokenSets.get(doc.id)!.has(term)).length]));
    const acronyms = new Set((query.match(/\b[A-Z]{2,8}\b/gu) || []).map(value => value.toLowerCase()));
    const methodPhrases = [...query.matchAll(/שיטת(?:\s+ביצוע)?\s+([\p{L}-]{3,})\s+([\p{L}-]{3,})/gu)]
        .filter(match => meaningfulRetrievalTerms(match[1]).size && meaningfulRetrievalTerms(match[2]).size)
        .map(match => `${match[1]} ${match[2]}`.toLowerCase());
    const candidateDetails = (doc: WorkChangeDocument) => {
        const matches = [...terms].filter(term => tokenSets.get(doc.id)!.has(term));
        const uncommon = matches.filter(term => (frequency.get(term) || 0) <= Math.max(2, documents.length * 0.25));
        const sameLocation = locations.some(location => String(doc.extracted_text || '').toLowerCase().includes(location));
        const specificSubject = matches.some(term => acronyms.has(term))
            || methodPhrases.some(phrase => String(doc.extracted_text || '').toLowerCase().includes(phrase));
        const related = acronyms.size || methodPhrases.length ? specificSubject
            : (sameLocation && matches.filter(term => !locationTerms.has(term)).length >= 2)
                || (matches.length >= 3 && uncommon.length > 0 && matches.length >= terms.size * 0.5);
        return { matches, related };
    };
    const referenceDocuments = documents.filter(doc => doc.id === primary?.id
        || (!/^(?:CONTRACT|BOQ|SPECS|TENDER)$/iu.test(doc.category || '') && candidateDetails(doc).related));
    const referenceViews = referenceDocuments.flatMap(doc => {
        const body = String(doc.extracted_text || '');
        return (doc.id === primary?.id || body.length <= 16_000 ? [body]
            : selectContractContext({ id: doc.id, extracted_text: body }, query, 3_500).source_anchors.map(anchor => anchor.quote))
            .map(body => ({ document: doc, body }));
    });
    const refs = referenceViews.flatMap(view => itemCodes(view.body)
        .filter(code => /סעיפ|items?|positions?/iu.test(view.body.slice(Math.max(0, code.index - 100), code.index)))
        .map(code => ({ ...code, document: view.document })));
    const intervals = referenceViews.flatMap(view => [...view.body.matchAll(/(\d{1,3}(?:\.\d{1,4}){2,4})\s*[-–—]\s*(\d{1,3}(?:\.\d{1,4}){2,4})/gu)]
        .filter(match => /סעיפ|items?|positions?/iu.test(view.body.slice(Math.max(0, match.index - 100), match.index)))
        .map(match => ({ first: canonicalCode(match[1]).split('.'), last: canonicalCode(match[2]).split('.'), raw: match[0], document: view.document })));
    const intervalFor = (key: string) => { const parts = key.split('.');
        return intervals.find(range => parts.length === range.first.length && range.first.slice(0, -1).join('.') === parts.slice(0, -1).join('.')
            && range.last.slice(0, -1).join('.') === parts.slice(0, -1).join('.')
            && Number(parts.at(-1)) >= Number(range.first.at(-1)) && Number(parts.at(-1)) <= Number(range.last.at(-1))); };
    const documentRefs = referenceViews.flatMap(view => [...view.body.matchAll(/(?:מספרנו|מספר\s+(?:הצעה|מכתב)|הצעה\s*מס[׳']?)\s*[:\-]?\s*(\d{5,}(?:[-/]\d{2,})*)/gu)]
        .map(match => ({ raw: match[1], prefix: match[1].split(/[-/]/)[0], document: view.document })));
    const directIds = new Set([finding.target_contract_doc_id,
        ...(Array.isArray(evidence.linked_ids) ? evidence.linked_ids.filter(id => typeof id === 'string') : [])].filter(Boolean));
    const ranked = documents.flatMap(doc => {
        const isPrimary = doc.id === primary?.id;
        const direct = directIds.has(doc.id);
        const contract = /^(?:CONTRACT|BOQ|SPECS|TENDER)$/iu.test(doc.category || '');
        const allCodes = itemCodes(String(doc.extracted_text || ''));
        const matchingCodes = allCodes.filter(code => refs.some(ref => ref.key === code.key) || intervalFor(code.key));
        const matchingDocumentRefs = documentRefs.filter(ref => new RegExp(`(?:^|\\D)${ref.prefix}(?:\\D|$)`, 'u').test(doc.title || ''));
        const { matches, related: candidate } = candidateDetails(doc);
        if (!isPrimary && !direct && !contract && !matchingCodes.length && !matchingDocumentRefs.length && !candidate) return [];
        const referenceEvidence = [...matchingCodes.flatMap(code => {
            const ref = refs.find(item => item.key === code.key) || intervalFor(code.key);
            const anchor = ref && findEvidenceAnchor(ref.document, ref.raw);
            return anchor ? [anchor] : [];
        }), ...matchingDocumentRefs.flatMap(ref => {
            const anchor = findEvidenceAnchor(ref.document, ref.raw); return anchor ? [anchor] : [];
        })];
        const kind = isPrimary ? 'PRIMARY' as const : direct ? 'DIRECT' as const
            : referenceEvidence.length ? 'REFERENCE' as const : 'CANDIDATE' as const;
        const body = String(doc.extracted_text || '');
        let selection = selectContractContext({ id: doc.id, extracted_text: body },
            `${query}\n${refs.map(ref => ref.raw).join(' ')}`, 3_500);
        if (matchingCodes.length) {
            const ranges = matchingCodes.map(code => ({ start: Math.max(0, code.index - 400),
                end: allCodes.find(next => next.index > code.index)?.index ?? body.length }))
                .sort((a, b) => a.start - b.start);
            const merged: typeof ranges = [];
            for (const range of ranges) {
                const previous = merged.at(-1);
                if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
                else merged.push({ ...range });
            }
            const complete = merged.length === 1 && merged[0].start === 0 && merged[0].end === body.length;
            selection = { ...selection, reason: 'EXPLICIT_ITEM_REFERENCES', complete,
                source_anchors: merged.map(range => anchorSourceRange(doc, range.start, range.end)),
                limitations: complete ? [] : ['Only cited item ranges and adjacent context selected; omitted text does not prove exclusion.'] };
        }
        const source: WorkChangeSource = { ...doc, title: doc.title || doc.id,
            role: isPrimary ? 'PRIMARY' : contract ? 'CONTRACT' : 'RELATED',
            connection: { kind, evidence: referenceEvidence }, selection, referencedItemCodes: [...new Set(matchingCodes.map(code => code.key))],
            readiness: assessDocumentSourceReadiness(doc) };
        const score = (isPrimary ? 10000 : direct ? 8000 : referenceEvidence.length ? 6000 : 0)
            + matches.reduce((sum, term) => sum + Math.log(1 + documents.length / Math.max(1, frequency.get(term) || 1)), 0)
            + (contract ? 10 : 0);
        return [{ source, score }];
    }).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id));
    const sources = ranked.map(row => row.source);
    const limitations = primary ? [] : ['primary_source_missing'];
    if (sources.some(source => !source.readiness.canCompare)) limitations.push('source_reading_requires_review');
    const ownerNotes = (Array.isArray(evidence.issue_owner_notes) ? evidence.issue_owner_notes : []).map(record)
        .filter(note => note.origin === 'OWNER_NOTE' && typeof note.text === 'string');
    return { findingId: finding.id, projectId: finding.project_id, title: finding.title || '', query,
        primarySourceIds: primary ? [primary.id] : [], sources, ownerNotes, limitations };
}
