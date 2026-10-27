import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProjectReferenceAuthority, REFERENCE_AUTHORITY_DOCUMENT_COLUMNS, type AuthorityProjectDocument } from '@/utils/document-reference-authority-server';
import { buildBoundReferenceDocuments } from '@/utils/bound-reference-comparison';
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';
import { findEvidenceAnchor } from '@/utils/radar-evidence-assessment';
import { meaningfulRetrievalTerms } from '@/utils/contract-context-selection';
import { isLikelyContractBoqPricelist } from '@/utils/pricing-ledger-contract-sync';
import { rankSupportCandidates } from '@/utils/support-source-enrichment';
import type { PricingScopeCandidate, PricingScopeContext, PricingScopeSource } from './pricing-scope-review.ts';
import { buildWorkChangePacket } from './work-change-sources.ts';

type Row = Record<string, unknown>;
type ProjectDocument = AuthorityProjectDocument & { deleted_at?: string | null };
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

async function allRows(query: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
    const result: Row[] = [];
    for (let start = 0; ; start += 500) {
        const page = await query(start, start + 499);
        if (page.error) throw new Error(`Cannot load pricing sources: ${page.error.message}`);
        result.push(...(page.data || []) as Row[]);
        if ((page.data || []).length < 500) return result;
    }
}

function priceBasis(value: string, metadata: unknown): PricingScopeCandidate['priceBasis'] {
    const stored = text(object(metadata).price_basis).toUpperCase();
    if (stored === 'EXCL_VAT' || stored === 'INCL_VAT') return stored;
    const excluded = /ללא\s*מע["״]?מ|אינ[םןו]?\s+כולל(?:ים|ות)?\s*מע["״]?מ|לא\s+כולל(?:ים|ות)?\s*מע["״]?מ|(?:exclud(?:es?|ing)|without|exclusive of)\s+VAT/iu.test(value);
    const included = /(?:^|[^\p{L}])כולל\s*מע["״]?מ|(?:includ(?:es?|ing)|inclusive of)\s+VAT/iu.test(value);
    return excluded && !included ? 'EXCL_VAT' : included && !excluded ? 'INCL_VAT' : 'UNKNOWN';
}

// This reads an existing table, not a work instruction. The printed quantity is
// deliberately never exposed as the quantity to be performed.
function excerptRows(document: ProjectDocument): PricingScopeCandidate[] {
    const source = String(document.extracted_text || '');
    if (!/(?:סעיף|item)[\s\S]{0,90}(?:יחידה|unit)[\s\S]{0,90}(?:מחיר|price)/iu.test(source.slice(0, 600)) || !source.includes('\t')) return [];
    const starts = [...source.matchAll(/^[ \t]*(\d{1,3}(?:\.\d{1,4}){1,4})\t/gmu)];
    return starts.flatMap((match, index) => {
        const segment = source.slice(match.index, starts[index + 1]?.index ?? source.length);
        const amount = segment.match(/\n([^\n\t\d]{1,24})\t\s*\d+(?:[.,]\d+)?\s*\t\s*(\d+(?:[.,]\d+)?)/u);
        if (!amount) return [];
        const body = segment.slice(0, amount.index! + amount[0].length).trim();
        return [{ id: `${document.id}:${match[1]}`, sourceId: document.id, documentId: document.id, pricelistId: null,
            title: document.title, text: body, itemCode: match[1], unit: amount[1].trim(), rate: Number(amount[2].replace(',', '.')),
            page: findEvidenceAnchor(document, body)?.page ?? null, noteSourceIds: [], priceBasis: priceBasis(source, document.parsed_json),
            sourceType: /דקל|\bdekel\b/iu.test(source) ? 'DEKEL' : 'CUSTOM_ANALYSIS' }];
    });
}

function sectionContains(prefix: unknown, code: unknown) {
    const parent = text(prefix).replace(/\.$/u, '');
    const item = text(code);
    return Boolean(parent && (item === parent || item.startsWith(`${parent}.`)));
}

function sameEdition(row: Row, book: Row) {
    const edition = text(object(row.metadata).version_label);
    return !edition || !text(book.version_label) || edition === text(book.version_label);
}

function searchFilter(query: string) {
    const terms = [...meaningfulRetrievalTerms(query)].filter(term => /^[a-z\u0590-\u05ff]{3,}$/iu.test(term)).slice(0, 8);
    const codes = [...query.matchAll(/\b\d{1,3}(?:\.\d{1,4}){1,4}\b/gu)].map(match => match[0]).slice(0, 4);
    return [...codes.map(code => `item_code.eq.${code}`), ...terms.map(term => `description.ilike.%${term}%`)].join(',');
}

/** Read-only project context. Candidate retrieval never establishes suitability. */
export async function loadPricingScopeContext(args: {
    supabase: SupabaseClient; projectId: string; findingId: string;
}): Promise<PricingScopeContext> {
    const { supabase, projectId, findingId } = args;
    const [rawDocuments, findingResult, books] = await Promise.all([
        allRows((start, end) => supabase.from('documents').select(`${REFERENCE_AUTHORITY_DOCUMENT_COLUMNS}, deleted_at`)
            .eq('project_id', projectId).order('id').range(start, end)),
        supabase.from('contradictions').select('id, title, description, source_execution_doc_id, target_contract_doc_id, evidence_data')
            .eq('project_id', projectId).eq('id', findingId).maybeSingle(),
        allRows((start, end) => supabase.from('pricelists')
            .select('id, name, description, source_type, project_id, is_global, source_document_id, version_label, parse_status, metadata, intro_text, outro_text, terms_text')
            .or(`project_id.eq.${projectId},project_id.is.null,is_global.eq.true`).order('id').range(start, end)),
    ]);
    if (findingResult.error) throw findingResult.error;
    if (!findingResult.data) throw new Error('Finding not found in project');
    const finding = findingResult.data as Row;
    const evidence = object(finding.evidence_data);
    const query = [text(finding.title), text(evidence.work_quote)].join('\n');
    const documents = (rawDocuments as ProjectDocument[]).filter(document => !document.deleted_at);
    const authority = await loadProjectReferenceAuthority({ supabase, projectId, documents });
    const contractIds = new Set(authority.graph.documents.filter(document => document.role === 'PROJECT_CONTRACT').map(document => document.id));
    const excerptCandidates = documents.flatMap(excerptRows);
    const excerptIds = new Set(excerptCandidates.map(candidate => candidate.documentId));
    const workIds = new Set<string>();
    const directId = text(finding.source_execution_doc_id);
    if (directId) workIds.add(directId);
    else if (text(evidence.work_quote)) {
        const matches = documents.filter(document => findEvidenceAnchor(document, text(evidence.work_quote)));
        if (matches.length === 1) workIds.add(matches[0].id);
    }
    const casePacket = buildWorkChangePacket({ ...finding, id: findingId, project_id: projectId,
        source_execution_doc_id: text(finding.source_execution_doc_id), evidence_data: evidence },
        documents.map(document => ({ ...document, project_id: projectId })));
    const relatedSourceIds = casePacket.sources.filter(source => source.role === 'RELATED').map(source => source.id);
    const sources: PricingScopeSource[] = documents.filter(document => contractIds.has(document.id) || workIds.has(document.id) || excerptIds.has(document.id) || relatedSourceIds.includes(document.id))
        .map(document => ({ ...document, title: document.title || document.id, role: excerptIds.has(document.id) && !contractIds.has(document.id)
            ? 'PRICE' : contractIds.has(document.id) ? 'CONTRACT' : 'WORK', allowed: assessDocumentSourceReadiness(document).canCompare }));
    const filter = searchFilter(query);
    const itemResult = books.length && filter ? await supabase.from('pricelist_items')
        .select('id, pricelist_id, item_type, item_code, description, unit, rate, page_number, source_excerpt, parent_item_id, metadata')
        .in('pricelist_id', books.map(book => book.id)).eq('item_type', 'ITEM').or(filter).order('item_code').limit(80)
        : { data: [], error: null };
    if (itemResult.error) throw itemResult.error;
    const candidates: PricingScopeCandidate[] = [];
    for (const item of (itemResult.data || []) as Row[]) {
        const book = books.find(value => value.id === item.pricelist_id);
        if (!book) continue;
        const body = text(item.source_excerpt) || text(item.description);
        if (!body) continue;
        const original = text(book.source_document_id) ? documents.find(document => document.id === book.source_document_id) : null;
        const allowed = ['READY', 'COMPLETED', 'COMPLETE'].includes(text(book.parse_status)) && sameEdition(item, book)
            && (!text(book.source_document_id) || Boolean(original && assessDocumentSourceReadiness(original).canCompare));
        const sourceId = text(item.id);
        const bookText = [book.intro_text, book.outro_text, book.terms_text, body].map(text).join('\n');
        sources.push({ id: sourceId, title: `${text(book.name)} ${text(item.item_code)}`, role: 'PRICE', allowed,
            extracted_text: body, parsed_json: { pricing_source: { pricelist_id: book.id, pricelist_item_id: item.id,
                document_id: book.source_document_id || null, page: item.page_number || null,
                rate: typeof item.rate === 'number' ? item.rate : Number(item.rate), unit: text(item.unit) || null,
                price_basis: priceBasis(bookText, book.metadata) } } });
        candidates.push({ id: text(item.id), sourceId, pricelistId: text(book.id), documentId: text(book.source_document_id) || null,
            title: text(book.name), text: body, sourceType: isLikelyContractBoqPricelist({ ...book, id: text(book.id) }) ? 'BOQ' : text(book.source_type),
            itemCode: text(item.item_code), unit: text(item.unit) || null, rate: item.rate as number | string | null,
            page: typeof item.page_number === 'number' ? item.page_number : null, noteSourceIds: [], priceBasis: priceBasis(bookText, book.metadata),
            applicability: allowed ? 'CONFIRMED' : 'NEEDS_REVIEW' });
    }
    candidates.push(...excerptCandidates);
    const ranked = rankSupportCandidates(query, candidates, 8);
    const selected = [...ranked, ...candidates.filter(candidate => !ranked.some(item => item.id === candidate.id))]
        .sort((left, right) => Number(right.sourceType === 'BOQ') - Number(left.sourceType === 'BOQ')).slice(0, 8);
    const selectedBooks = [...new Set(selected.map(candidate => candidate.pricelistId).filter((id): id is string => Boolean(id)))];
    const notes = selectedBooks.length ? await allRows((start, end) => supabase.from('pricelist_items')
        .select('id, pricelist_id, item_code, description, source_excerpt, parent_item_id, metadata')
        .in('pricelist_id', selectedBooks).eq('item_type', 'NOTE').order('id').range(start, end)) : [];
    for (const candidate of selected) {
        const book = books.find(item => item.id === candidate.pricelistId);
        if (!book) continue;
        for (const note of notes.filter(item => item.pricelist_id === book.id && sameEdition(item, book)
            && (sectionContains(item.item_code, candidate.itemCode)
                || (item.id === (itemResult.data || []).find((row: Row) => row.id === candidate.id)?.parent_item_id)))) {
            const body = text(note.source_excerpt) || text(note.description);
            if (!body) continue;
            candidate.noteSourceIds.push(text(note.id));
            if (!sources.some(source => source.id === note.id)) sources.push({ id: text(note.id), title: text(book.name),
                role: 'PRICE', allowed: true, extracted_text: body });
        }
        for (const field of ['intro_text', 'terms_text', 'outro_text']) {
            const body = text(book[field]);
            if (!body) continue;
            const id = `${book.id}:${field}`;
            candidate.noteSourceIds.push(id);
            if (!sources.some(source => source.id === id)) sources.push({ id, title: `${text(book.name)} — ${field}`,
                role: 'PRICE', allowed: true, extracted_text: body });
        }
    }
    const bound = buildBoundReferenceDocuments(authority.graph);
    const referenceCandidates = authority.graph.documents.filter(document => document.role === 'REFERENCE').flatMap(document =>
        document.clauses.flatMap(clause => clause.id ? [{ id: clause.id, text: clause.text, title: document.title }] : []));
    for (const reference of rankSupportCandidates(query, referenceCandidates, 3)) {
        const confirmed = bound.find(document => document.id === reference.id);
        sources.push({ id: reference.id, title: reference.title || reference.id, role: 'REFERENCE', allowed: Boolean(confirmed),
            extracted_text: reference.text });
    }
    const selectedSourceIds = new Set([...selected.flatMap(candidate => [candidate.sourceId, ...candidate.noteSourceIds]),
        ...sources.filter(source => source.role !== 'PRICE' || workIds.has(source.id)).map(source => source.id)]);
    return { query, workQuote: text(evidence.work_quote) || undefined, workSourceIds: [...workIds].filter(id => sources.some(source => source.id === id && source.role !== 'PRICE')), relatedSourceIds,
        sources: sources.filter(source => selectedSourceIds.has(source.id)), candidates: selected };
}
