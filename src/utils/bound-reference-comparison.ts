import { createHash } from 'crypto';
import { resolveDocumentReferenceAuthority, type DocumentReferenceGraph, type DocumentReferenceLink } from '@/utils/document-reference-authority';
import { rankSupportCandidates } from '@/utils/support-source-enrichment';

export type BoundReferenceDocument = {
    id: string;
    title: string;
    category: string;
    extracted_text: string;
    extracted_text_hash: string;
    reference_authority: {
        version: string;
        reference_document_id: string;
        reference_chunk_id: string;
        page: number | null;
        section_code: string | null;
        edition: string | null;
        chain: DocumentReferenceLink[];
        precedence_evidence: DocumentReferenceGraph['precedenceEvidence'];
    };
};

export function buildBoundReferenceDocuments(graph: DocumentReferenceGraph): BoundReferenceDocument[] {
    return graph.documents.filter((document) => document.role === 'REFERENCE').flatMap((document) =>
        document.clauses.flatMap((clause) => {
            if (!clause.id || !clause.text.trim()) return [];
            const result = resolveDocumentReferenceAuthority(graph, { targetDocumentId: document.id,
                sectionCode: clause.sectionCode, edition: clause.edition,
                requireEdition: ['BLUE_BOOK', 'SHELF_CONTRACT_3210', 'ISRAELI_STANDARD'].includes(document.referenceType || '') });
            if (result.applicability !== 'CONFIRMED') return [];
            return [{ id: clause.id, title: document.title, category: 'INCORPORATED_REFERENCE',
                extracted_text: clause.text, extracted_text_hash: createHash('sha256').update(clause.text).digest('hex'),
                reference_authority: { version: 'references-v1', reference_document_id: document.id, reference_chunk_id: clause.id,
                    page: clause.page || null, section_code: clause.sectionCode || null, edition: clause.edition || null, chain: result.chain,
                    precedence_evidence: graph.precedenceEvidence.filter((evidence) => graph.documents.some((source) =>
                        source.id === evidence.documentId && source.role === 'PROJECT_CONTRACT')) },
            }];
        }));
}

export function selectBoundReferenceDocuments(documents: BoundReferenceDocument[], workText: string) {
    return rankSupportCandidates(workText, documents.map((document) => ({ id: document.id, text: document.extracted_text })), 2)
        .map((candidate) => documents.find((document) => document.id === candidate.id)!);
}

export function buildReferenceAwareContractSignature(base: string, documents: BoundReferenceDocument[]) {
    if (documents.length === 0) return base;
    return createHash('sha256').update(JSON.stringify([base,
        documents.map((document) => [document.id, document.extracted_text_hash, document.reference_authority]).sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    ])).digest('hex');
}

export function contractSourcePointers(document: { id: string; reference_authority?: BoundReferenceDocument['reference_authority'] } | null) {
    return {
        targetContractDocumentId: document?.reference_authority ? null : document?.id || null,
        displayDocumentId: document?.reference_authority?.reference_document_id || document?.id || null,
        referenceAuthority: document?.reference_authority || null,
    };
}
