import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { isProjectContractBaseDocument, isReferenceDocument } from './contract-document-hierarchy.ts';
import { resolveDocumentReferenceAuthority, type DocumentReferenceGraph, type DocumentReferenceLink } from './document-reference-authority.ts';
import { anchorSourceRange, normalizeEvidenceSource, type EvidenceAnchor } from './radar-evidence-assessment.ts';
import { documentEventDate, type IssueHistoryDocument } from './radar-issue-history.ts';
import { isUnexecutedAnnexForm, ruleConcerns, type RequirementKind } from './requirement-statement-comparison.ts';

export type RequirementRule = {
    documentTitle: string; sourceKind: 'PROJECT_CONTRACT' | 'INCORPORATED_REFERENCE';
    sourceCategory: string; referenceDocumentId: string | null; date: string | null;
    anchor: EvidenceAnchor; chain: DocumentReferenceLink[];
    applicability: 'CONFIRMED' | 'REFERENCE_ONLY' | 'NEEDS_REVIEW'; reason: string;
};
export type RequirementContextGap = { documentId: string; documentTitle: string; reason: string; quote: string };
const KINDS: RequirementKind[] = ['METHOD_CHANGE', 'SIGN_ANNEX', 'BINDING_ANNEX', 'NO_EXTRA_PAYMENT', 'SUBMIT_PRICE', 'RESPOND', 'WAIVE_CLAIMS'];

export function isRequirementContractSource(document: IssueHistoryDocument) {
    const metadata = document.parsed_json && typeof document.parsed_json === 'object' ? document.parsed_json as Record<string, unknown> : {};
    const roles = [document.category, metadata.category].map(value => String(value || '').toUpperCase());
    if (roles.some(role => ['EXECUTION', 'SITE_REPORT', 'PROTOCOL', 'INVOICE', 'CHANGE_ORDER', 'LETTER', 'PHOTO', 'VIDEO'].includes(role))) return false;
    if (isUnexecutedAnnexForm(String(document.extracted_text || ''))) return false;
    return !isReferenceDocument(document) && (roles.some(role => ['CONTRACT', 'BOQ', 'SPECS', 'TENDER'].includes(role)) || isProjectContractBaseDocument(document));
}

// Keep whole numbered clauses (including qualifications), and exact raw offsets.
// Very long unsplit passages stay candidates, but cannot prove a pairwise claim.
export function requirementClauseRanges(text: string) {
    const starts = new Set([0]);
    for (const match of text.matchAll(/\n\s*\n|\n(?=[ \t]*\d{1,2}\s*\.\s*\d{1,2}(?:\s*\.\s*\d{1,2})?\s)/gu)) starts.add(match.index + match[0].length);
    const sorted = [...starts].sort((a, b) => a - b);
    return sorted.map((start, index) => ({ start, end: sorted[index + 1] ?? text.length })).filter(range => text.slice(range.start, range.end).trim());
}

export function buildRequirementContext(input: { documents: IssueHistoryDocument[]; referenceGraph?: DocumentReferenceGraph; asOf: string }) {
    const rules: RequirementRule[] = [], gaps: RequirementContextGap[] = [];
    const add = (document: IssueHistoryDocument, metadata: Omit<RequirementRule, 'anchor'>, page?: number | null) => {
        const source = String(document.extracted_text || '');
        for (const range of requirementClauseRanges(source)) {
            const raw = source.slice(range.start, range.end), normalized = normalizeEvidenceSource(raw);
            if (!KINDS.some(kind => ruleConcerns(kind, normalized))) continue;
            const lead = raw.search(/\S/u), tail = raw.search(/\s*$/u);
            const anchor = anchorSourceRange(document, range.start + lead, range.start + tail);
            if (page != null) anchor.page = page;
            rules.push({ ...metadata, anchor });
        }
    };
    for (const document of input.documents) {
        if (!isRequirementContractSource(document)) continue;
        const readiness = assessDocumentSourceReadiness(document);
        if (!readiness.canCompare) {
            gaps.push({ documentId: document.id, documentTitle: document.title || '', reason: 'project_source_not_ready', quote: readiness.markerQuote || '' });
            continue;
        }
        const date = documentEventDate(document).date;
        if (date && date > input.asOf) continue;
        add(document, { documentTitle: document.title || '', sourceKind: 'PROJECT_CONTRACT', sourceCategory: String(document.category || ''),
            referenceDocumentId: null, date, chain: [], applicability: 'CONFIRMED', reason: 'project_contract_document' });
    }
    if (input.referenceGraph) {
        for (const document of input.referenceGraph.documents.filter(source => source.role === 'REFERENCE')) {
            for (const clause of document.clauses) {
                if (!clause.id || !KINDS.some(kind => ruleConcerns(kind, clause.text))) continue;
                const authority = resolveDocumentReferenceAuthority(input.referenceGraph, { targetDocumentId: document.id,
                    sectionCode: clause.sectionCode, edition: clause.edition,
                    requireEdition: ['BLUE_BOOK', 'SHELF_CONTRACT_3210', 'ISRAELI_STANDARD'].includes(document.referenceType || '') });
                if (authority.applicability !== 'CONFIRMED') gaps.push({ documentId: document.id, documentTitle: document.title, reason: authority.reason,
                    quote: authority.chain.at(-1)?.quote || '' });
                // A later edition cannot govern an earlier project event. A
                // dated publisher/chapter header also proves a later year even
                // when the library has not established an exact edition yet.
                const header = normalizeEvidenceSource(clause.text.slice(0, 500));
                const publicationYear = Number(clause.edition?.match(/\b((?:19|20)\d{2})\b/u)?.[1]
                    || header.match(/המפרט הכללי.{0,120}פרק\s*\d.{0,85}(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s*((?:19|20)\d{2})/u)?.[1] || 0);
                if (publicationYear > Number(input.asOf.slice(0, 4))) {
                    gaps.push({ documentId: document.id, documentTitle: document.title, reason: 'reference_publication_after_available_period', quote: clause.text.slice(0, 500) });
                    continue;
                }
                const rootDates = authority.chain.flatMap(link => {
                    const root = input.documents.find(source => source.id === link.sourceDocumentId);
                    const date = root ? documentEventDate(root).date : null;
                    return date ? [date] : [];
                }).sort();
                add({ id: clause.id, title: document.title, extracted_text: clause.text }, {
                    documentTitle: document.title, sourceKind: 'INCORPORATED_REFERENCE', sourceCategory: document.referenceType || 'REFERENCE',
                    referenceDocumentId: document.id, date: rootDates.at(-1) || null, chain: authority.chain, applicability: authority.applicability, reason: authority.reason,
                }, clause.page);
            }
        }
        gaps.push(...input.referenceGraph.issues.filter(issue => ['project_source_not_ready', 'reference_text_unavailable'].includes(issue.reason))
            .map(issue => ({ documentId: issue.sourceDocumentId, documentTitle: issue.targetLabel, reason: issue.reason, quote: issue.quote })));
    } else gaps.push({ documentId: '', documentTitle: '', reason: 'reference_context_unavailable', quote: '' });
    return { rules, gaps: [...new Map(gaps.map(gap => [`${gap.documentId}:${gap.reason}`, gap])).values()],
        precedenceEvidence: input.referenceGraph?.precedenceEvidence || [] };
}
