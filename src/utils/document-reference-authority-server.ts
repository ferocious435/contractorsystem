import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { isProjectContractBaseDocument, isReferenceDocument } from '@/utils/contract-document-hierarchy';
import { buildDocumentReferenceGraph, referenceEditionFromText,
    type ReferenceAuthorityDocument, type DocumentReferenceGraph } from '@/utils/document-reference-authority';
import { buildBoundReferenceDocuments, type BoundReferenceDocument } from '@/utils/bound-reference-comparison';
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';

export const REFERENCE_AUTHORITY_DOCUMENT_COLUMNS = 'id, title, category, doc_type, extracted_text, parsed_json, ocr_status, storage_path';

export type AuthorityProjectDocument = {
    id: string;
    title?: string | null;
    category?: string | null;
    doc_type?: string | null;
    extracted_text?: string | null;
    parsed_json?: Record<string, unknown> | null;
    ocr_status?: string | null;
    storage_path?: string | null;
};

export type AuthorityReferenceDocument = {
    id: string;
    title?: string | null;
    reference_type?: string | null;
    source_document_id?: string | null;
    text_hash?: string | null;
    status?: string | null;
};

type LibraryChunk = {
    id: string;
    reference_document_id: string;
    text?: string | null;
    page_from?: number | null;
    section_code?: string | null;
};

type StoredIncorporation = {
    reference_document_id: string;
    incorporated_by_document_id?: string | null;
    quote?: string | null;
    status?: string | null;
};

const PAGE_SIZE = 500;
const WORK_ROLES = new Set(['EXECUTION', 'SITE_REPORT', 'PROTOCOL', 'INVOICE', 'CHANGE_ORDER', 'PHOTO', 'VIDEO', 'LETTER']);
const CONTRACT_ROLES = new Set(['CONTRACT', 'BOQ', 'SPECS', 'TENDER']);
type ComparisonReferenceContext = { graph: DocumentReferenceGraph; signature: string; boundDocuments: BoundReferenceDocument[] };
const boundSourceCache = new Map<string, { key: string; expiresAt: number; promise: Promise<ComparisonReferenceContext> }>();

async function readAllRows<T>(getPage: (start: number, end: number) => PromiseLike<{
    data: unknown[] | null;
    error: { message: string } | null;
}>) {
    const rows: T[] = [];
    for (let start = 0; ; start += PAGE_SIZE) {
        const result = await getPage(start, start + PAGE_SIZE - 1);
        if (result.error) throw new Error(`Cannot read reference authority sources: ${result.error.message}`);
        const page = (result.data || []) as T[];
        rows.push(...page);
        if (page.length < PAGE_SIZE) return rows;
    }
}

function projectDocumentRole(document: AuthorityProjectDocument): ReferenceAuthorityDocument['role'] {
    const roles = [document.category, document.parsed_json?.category].map((value) => String(value || '').toUpperCase());
    if (roles.some((role) => WORK_ROLES.has(role))) return 'WORK_EVIDENCE';
    if (isReferenceDocument(document) || roles.includes('REFERENCE')) return 'REFERENCE';
    return roles.some((role) => CONTRACT_ROLES.has(role)) || isProjectContractBaseDocument(document)
        ? 'PROJECT_CONTRACT' : 'WORK_EVIDENCE';
}

function referenceType(document: AuthorityProjectDocument) {
    const stored = String(document.parsed_json?.reference_family || '');
    if (stored) return stored.toUpperCase();
    if (/3210/u.test(document.title || '')) return 'SHELF_CONTRACT_3210';
    if (/ספר\s*כחול|מפרט\s*כללי/u.test(document.title || '')) return 'BLUE_BOOK';
    return 'OTHER_REFERENCE';
}

export async function loadProjectReferenceAuthority(params: {
    supabase: SupabaseClient;
    projectId: string;
    documents?: AuthorityProjectDocument[];
    references?: AuthorityReferenceDocument[];
}): Promise<{ graph: DocumentReferenceGraph; signature: string }> {
    const { supabase, projectId } = params;
    const [documents, references, incorporations] = await Promise.all([
        params.documents || readAllRows<AuthorityProjectDocument>((start, end) => supabase.from('documents')
            .select(REFERENCE_AUTHORITY_DOCUMENT_COLUMNS).eq('project_id', projectId).order('id').range(start, end)),
        params.references || readAllRows<AuthorityReferenceDocument>((start, end) => supabase.from('reference_documents')
            .select('id, title, reference_type, source_document_id, text_hash, status')
            .or(`project_id.eq.${projectId},project_id.is.null`).eq('status', 'READY').order('id').range(start, end)),
        readAllRows<StoredIncorporation>((start, end) => supabase.from('reference_document_incorporations')
            .select('reference_document_id, incorporated_by_document_id, quote, status').eq('project_id', projectId).order('id').range(start, end)),
    ]);
    const readyReferences = references.filter((row) => row.status === 'READY');
    const chunks = readyReferences.length ? await readAllRows<LibraryChunk>((start, end) => supabase.from('reference_document_chunks')
        .select('id, reference_document_id, text, page_from, section_code')
        .in('reference_document_id', readyReferences.map((row) => row.id)).neq('chunk_type', 'DOCUMENT')
        .order('reference_document_id').order('ordinal').order('id').range(start, end)) : [];
    const sourceAliases = new Map(readyReferences.flatMap((row) => row.source_document_id ? [[row.source_document_id, row.id] as const] : []));
    const sources: ReferenceAuthorityDocument[] = [];
    const blockedSources: Array<{ document: AuthorityProjectDocument; quote: string }> = [];
    for (const document of documents) {
        const role = projectDocumentRole(document);
        if (role === 'WORK_EVIDENCE' || sourceAliases.has(document.id)) continue;
        const readiness = assessDocumentSourceReadiness(document);
        const blockedRoot = role === 'PROJECT_CONTRACT' && !readiness.canCompare;
        if (blockedRoot) blockedSources.push({ document, quote: readiness.markerQuote || '' });
        // Keep the source identity for inspection, but not its clauses: another
        // contract must not turn this unread/draft source into a binding bridge.
        sources.push({ id: document.id, title: document.title || document.id, role: blockedRoot ? 'REFERENCE' : role,
            referenceType: role === 'REFERENCE' ? referenceType(document) : null,
            clauses: !blockedRoot && document.extracted_text?.trim() ? [{ text: document.extracted_text }] : [] });
    }
    for (const reference of readyReferences) {
        sources.push({ id: reference.id, title: reference.title || reference.id, role: 'REFERENCE', referenceType: reference.reference_type,
            clauses: chunks.filter((chunk) => chunk.reference_document_id === reference.id && chunk.text?.trim()).map((chunk) => ({
                id: chunk.id, text: chunk.text!, page: chunk.page_from || null,
                // Older section_code values were guessed from page numbers; require a real chapter heading.
                sectionCode: chunk.text!.match(/(?:^|\n)\s*(?:פרק|chapter)\s+(\d+(?:\.\d+)*)/imu)?.[1] || null,
                edition: referenceEditionFromText(chunk.text!),
            })),
        });
    }
    sources.sort((left, right) => left.id.localeCompare(right.id));
    const declaredLinks = incorporations.map((row) => ({
        sourceDocumentId: sourceAliases.get(row.incorporated_by_document_id || '') || row.incorporated_by_document_id || '',
        targetDocumentId: row.reference_document_id, quote: row.quote || '', status: row.status,
    }));
    const graph = buildDocumentReferenceGraph({ documents: sources, declaredLinks });
    for (const { document, quote } of blockedSources) graph.issues.push({
        reason: 'project_source_not_ready', sourceDocumentId: document.id,
        targetLabel: document.title || document.id, quote,
    });
    for (const document of sources.filter((source) => source.clauses.length === 0)) graph.issues.push({
        reason: 'reference_text_unavailable', sourceDocumentId: document.id, targetLabel: document.title, quote: '',
    });
    const signature = createHash('sha256').update(JSON.stringify({ version: 'references-v1', sources, declaredLinks })).digest('hex');
    return { graph, signature };
}

export async function loadProjectComparisonReferenceContext(params: {
    supabase: SupabaseClient;
    projectId: string;
    documents: AuthorityProjectDocument[];
}) {
    const { supabase, projectId, documents } = params;
    const references = await readAllRows<AuthorityReferenceDocument>((start, end) => supabase.from('reference_documents')
        .select('id, title, reference_type, source_document_id, text_hash, status')
        .or(`project_id.eq.${projectId},project_id.is.null`).eq('status', 'READY').order('id').range(start, end));
    const key = createHash('sha256').update(JSON.stringify({ documents, references })).digest('hex');
    const cached = boundSourceCache.get(projectId);
    if (cached?.key === key && cached.expiresAt > Date.now()) return cached.promise;
    const promise = loadProjectReferenceAuthority({ supabase, projectId, documents, references })
        .then(({ graph, signature }) => ({ graph, signature, boundDocuments: buildBoundReferenceDocuments(graph) }));
    boundSourceCache.set(projectId, { key, promise, expiresAt: Date.now() + 60_000 });
    if (boundSourceCache.size > 8) boundSourceCache.delete(boundSourceCache.keys().next().value!);
    try { return await promise; }
    catch (error) {
        if (boundSourceCache.get(projectId)?.promise === promise) boundSourceCache.delete(projectId);
        throw error;
    }
}

export async function loadProjectBoundReferenceDocuments(params: {
    supabase: SupabaseClient; projectId: string; documents: AuthorityProjectDocument[];
}) {
    return (await loadProjectComparisonReferenceContext(params)).boundDocuments;
}
