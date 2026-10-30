import type { SupabaseClient } from '@supabase/supabase-js';
import { generateComparisonText, getComparisonAiIdentity } from '@/server/ai/comparison.server';
import { isReferenceDocument } from '@/utils/contract-document-hierarchy';
import { buildDocumentScanChunks, selectRelevantContractChunks } from '@/utils/document-scan-chunks';
import {
    buildSafeIlikeOrFilter,
    buildSupportAnalysisPrompt,
    extractSupportSearchTerms,
    rankSupportCandidates,
    selectRelevantSupportIds,
    SUPPORT_ANALYSIS_RESPONSE_SCHEMA,
    SUPPORT_ANALYSIS_VERSION,
    supportSourceSignature,
    checkedSupportSummary,
    type SupportCandidate,
} from '@/utils/support-source-enrichment';
import { loadProjectReferenceAuthority, REFERENCE_AUTHORITY_DOCUMENT_COLUMNS } from '@/utils/document-reference-authority-server';
import { resolveDocumentReferenceAuthority, type DocumentReferenceGraph } from '@/utils/document-reference-authority';
import { isTechnicalRadarExclusion } from '@/utils/radar-review-disposition';
import { loadPricingScopeContext } from '@/utils/pricing-scope-sources-server';
import { reviewPricingScope } from '@/utils/pricing-scope-review-server';
import { validatePricingScope, type PricingScopeCandidate, type PricingScopeResult } from '@/utils/pricing-scope-review';
import { cachedPricingScope, pricingScopeSignature } from '@/utils/pricing-scope-signature';
import type { AiExecutionContext } from '@/server/ai/contracts';

type AnyRecord = Record<string, unknown>;

type FindingRow = {
    id: string;
    title?: string | null;
    description?: string | null;
    category?: string | null;
    strategy_advice?: string | null;
    evidence_data?: AnyRecord | null;
    scan_signature?: string | null;
};

type DocumentRow = {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
    extracted_text_hash?: string | null;
    parsed_json?: AnyRecord | null;
    doc_type?: string | null;
    ocr_status?: string | null;
    storage_path?: string | null;
};

type ReferenceRow = {
    id: string;
    title?: string | null;
    reference_type?: string | null;
    authority_scope?: string | null;
    text_hash?: string | null;
    status?: string | null;
    source_document_id?: string | null;
};

type ReferenceChunkRow = {
    id: string;
    reference_document_id: string;
    title?: string | null;
    section_code?: string | null;
    page_from?: number | null;
    text?: string | null;
};

type PriceListRow = {
    id: string;
    name?: string | null;
    source_type?: string | null;
    content_hash?: string | null;
    parse_status?: string | null;
};

export type SupportEnrichmentProgress = {
    processed: number;
    total: number;
    failed: number;
    currentTitle: string;
};

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): AnyRecord {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function getReferenceType(value: { title?: string | null; reference_type?: string | null; parsed_json?: AnyRecord | null }) {
    const parsedFamily = text(value.parsed_json?.reference_family).toUpperCase();
    const storedType = text(value.reference_type).toUpperCase();
    if (parsedFamily || storedType) return parsedFamily || storedType;
    const title = text(value.title).toLowerCase();
    if (/3210|חוזה\s*מדף|shelf\s*contract/.test(title)) return 'SHELF_CONTRACT_3210';
    if (/ספר\s*כחול|הספר\s*הכחול|מפרט\s*כללי|blue\s*book/.test(title)) return 'BLUE_BOOK';
    return 'OTHER_REFERENCE';
}

async function loadReferenceRows(supabase: SupabaseClient, projectId: string) {
    const { data, error } = await supabase
        .from('reference_documents')
        .select('id, title, reference_type, authority_scope, text_hash, status, source_document_id')
        .or(`project_id.eq.${projectId},project_id.is.null`)
        .eq('status', 'READY');
    if (error) {
        throw new Error('Reference sources could not be read');
    }
    return (data || []) as ReferenceRow[];
}

async function loadPriceLists(supabase: SupabaseClient, projectId: string) {
    const { data, error } = await supabase
        .from('pricelists')
        .select('id, name, source_type, content_hash, parse_status')
        .or(`project_id.eq.${projectId},project_id.is.null,is_global.eq.true`);
    if (error) {
        throw new Error('Price sources could not be read');
    }
    return (data || []) as PriceListRow[];
}

async function findReferenceCandidates(params: {
    supabase: SupabaseClient;
    query: string;
    terms: string[];
    references: ReferenceRow[];
    fallbackReferenceDocuments: DocumentRow[];
    authorityGraph: DocumentReferenceGraph;
}) {
    const {
        supabase,
        query,
        terms,
        references,
        fallbackReferenceDocuments,
        authorityGraph,
    } = params;
    const candidates: SupportCandidate[] = [];
    const referenceIds = references.map((row) => row.id);
    const filter = buildSafeIlikeOrFilter('text', terms);

    if (referenceIds.length > 0 && filter) {
        const { data, error } = await supabase
            .from('reference_document_chunks')
            .select('id, reference_document_id, title, section_code, page_from, text')
            .in('reference_document_id', referenceIds)
            .or(filter)
            .limit(50);
        if (error) {
            console.warn('[scan:support] Reference search failed:', error.message);
        } else {
            for (const chunk of (data || []) as ReferenceChunkRow[]) {
                const reference = references.find((row) => row.id === chunk.reference_document_id);
                if (!reference || !text(chunk.text)) continue;
                const referenceType = getReferenceType(reference);
                const sourceClause = authorityGraph.documents.find((row) => row.id === reference.id)?.clauses.find((row) => row.id === chunk.id);
                const authority = resolveDocumentReferenceAuthority(authorityGraph, {
                    targetDocumentId: reference.id,
                    sectionCode: sourceClause?.sectionCode,
                    edition: sourceClause?.edition,
                    requireEdition: true,
                });
                if (authority.reason === 'project_contract_exclusion'
                    || (!sourceClause?.sectionCode && authority.contractEvidence?.length)) continue;
                candidates.push({
                    id: chunk.id,
                    sourceId: reference.id,
                    title: reference.title,
                    sourceType: referenceType,
                    page: chunk.page_from || null,
                    sectionCode: sourceClause?.sectionCode || null,
                    text: text(chunk.text).slice(0, 1_200),
                    applicability: authority.applicability,
                    applicabilityReason: authority.reason,
                    incorporationEvidence: authority.chain.map((link) => ({
                        document_id: link.sourceDocumentId, title: link.sourceTitle, quote: link.quote,
                        target_document_id: link.targetDocumentId, target_title: link.targetTitle,
                        page: link.sourcePage,
                    })),
                });
            }
        }
    }

    const fallbackChunks = buildDocumentScanChunks(fallbackReferenceDocuments, 2_500, 250);
    const selectedFallbackChunks = selectRelevantContractChunks(fallbackChunks, query, 6_000, 3);
    for (const chunk of selectedFallbackChunks) {
        const document = fallbackReferenceDocuments.find((row) => row.id === chunk.documentId);
        if (!document) continue;
        const referenceType = getReferenceType(document);
        const authority = resolveDocumentReferenceAuthority(authorityGraph, {
            targetDocumentId: document.id, requireEdition: true,
        });
        // This fallback has no verified section mapping. It cannot establish
        // that an excerpt lies outside a scoped contractual restriction.
        if (authority.reason === 'project_contract_exclusion' || authority.contractEvidence?.length) continue;
        candidates.push({
            id: `${document.id}:${chunk.index}`,
            sourceId: document.id,
            title: document.title,
            sourceType: referenceType,
            page: null,
            sectionCode: null,
            text: chunk.text.slice(0, 1_200),
            applicability: authority.applicability,
            applicabilityReason: authority.reason,
            incorporationEvidence: authority.chain.map((link) => ({
                document_id: link.sourceDocumentId, title: link.sourceTitle, quote: link.quote,
                target_document_id: link.targetDocumentId, target_title: link.targetTitle,
                page: link.sourcePage,
            })),
        });
    }

    return rankSupportCandidates(query, candidates, 4);
}

function mapReferenceEvidence(candidate: SupportCandidate) {
    return {
        reference_document_id: candidate.sourceId || null,
        reference_chunk_id: candidate.id,
        title: candidate.title || null,
        reference_type: candidate.sourceType || null,
        applicability: candidate.applicability || 'REFERENCE_ONLY',
        applicability_reason: candidate.applicabilityReason || null,
        incorporation_evidence: candidate.incorporationEvidence || [],
        page: candidate.page || null,
        section_code: candidate.sectionCode || null,
        quote: candidate.text,
    };
}

function mapPriceEvidence(candidate: SupportCandidate | PricingScopeCandidate) {
    return {
        pricelist_id: 'pricelistId' in candidate ? candidate.pricelistId || null : candidate.sourceId || null,
        pricelist_item_id: 'pricelistId' in candidate && !candidate.pricelistId ? null : candidate.id,
        document_id: 'documentId' in candidate ? candidate.documentId || null : null,
        pricelist_name: candidate.title || null,
        source_type: candidate.sourceType || null,
        item_code: candidate.itemCode || null,
        description: candidate.text,
        unit: candidate.unit || null,
        unit_price_excl_vat: candidate.rate ?? null,
        page: candidate.page || null,
    };
}

export async function enrichProjectFindingsWithSupportSources(params: {
    supabase: SupabaseClient;
    projectId: string;
    onProgress?: (progress: SupportEnrichmentProgress) => Promise<void> | void;
    execution: AiExecutionContext;
}) {
    const { supabase, projectId, onProgress, execution } = params;
    const identity = getComparisonAiIdentity(execution);
    const [documentsResult, findingsResult, references, priceLists] = await Promise.all([
        supabase
            .from('documents')
            .select(`${REFERENCE_AUTHORITY_DOCUMENT_COLUMNS}, extracted_text_hash`)
            .eq('project_id', projectId),
        supabase
            .from('contradictions')
            .select('id, title, description, category, strategy_advice, evidence_data, scan_signature')
            .eq('project_id', projectId)
            .neq('status', 'ARCHIVED')
            .not('scan_signature', 'is', null)
            .order('created_at', { ascending: true }),
        loadReferenceRows(supabase, projectId),
        loadPriceLists(supabase, projectId),
    ]);

    if (documentsResult.error) throw documentsResult.error;
    if (findingsResult.error) throw findingsResult.error;

    const documents = (documentsResult.data || []) as DocumentRow[];
    const findings = ((findingsResult.data || []) as FindingRow[]).filter(finding => !isTechnicalRadarExclusion(finding));
    const fallbackReferenceDocuments = documents.filter((document) => isReferenceDocument(document) && text(document.extracted_text));
    const authority = await loadProjectReferenceAuthority({ supabase, projectId, documents, references });
    const sourceSignature = supportSourceSignature([
        authority.signature,
        ...references.map((row) => [row.id, row.text_hash, row.status]),
        ...fallbackReferenceDocuments.map((row) => [row.id, row.extracted_text_hash]),
        ...priceLists.map((row) => [row.id, row.content_hash, row.parse_status]),
    ]);
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const finding of findings) {
        const evidence = readRecord(finding.evidence_data);
        const existingSupport = readRecord(evidence.support_analysis);
        try {
            await execution.checkActive();
            const query = [
                finding.title,
                text(evidence.work_quote),
            ].filter(Boolean).join('\n');
            const terms = extractSupportSearchTerms(query);
            const referenceCandidates = await findReferenceCandidates({
                supabase,
                query,
                terms,
                references,
                fallbackReferenceDocuments,
                authorityGraph: authority.graph,
            });
            const needsCommercialReview = /סתירה|שינוי|חריג|פעולה/iu.test(text(finding.category));
            let scopeReview: PricingScopeResult | null = null;
            let scopeSignature: string | null = null;
            let priceCandidates: PricingScopeCandidate[] = [];
            const pricingContext=needsCommercialReview?await loadPricingScopeContext({supabase,projectId,findingId:finding.id}):null;
            if(pricingContext)scopeSignature=pricingScopeSignature(pricingContext);
            const savedScope=pricingContext&&scopeSignature?cachedPricingScope(existingSupport,scopeSignature,pricingContext):null;
            const contextSignature=supportSourceSignature([{version:SUPPORT_ANALYSIS_VERSION,sourceSignature,query,contractQuote:text(evidence.contract_quote),workQuote:text(evidence.work_quote),needsCommercialReview,scopeSignature,referenceCandidates}]);
            if(existingSupport.version===SUPPORT_ANALYSIS_VERSION&&existingSupport.source_signature===sourceSignature&&existingSupport.status==='COMPLETE'
                &&(existingSupport.context_signature===contextSignature||savedScope&&referenceCandidates.length===0&&Array.isArray(existingSupport.reference_evidence)&&existingSupport.reference_evidence.length===0)
                &&(!needsCommercialReview||savedScope)){
                skipped++;processed++;await onProgress?.({processed,total:findings.length,failed,currentTitle:text(finding.title)});continue;
            }
            if (needsCommercialReview) {
                scopeReview = savedScope || cachedPricingScope(evidence.pricing_evaluation, scopeSignature!,pricingContext!) || (pricingContext!.candidates.length ? await reviewPricingScope(pricingContext!, execution)
                    : validatePricingScope(pricingContext!, { requirements: [], positions: [], lines: [] }));
                const selectedIds = new Set(scopeReview.lines.filter(line => line.unitPriceExclVat.value !== null).map(line => line.candidateId));
                priceCandidates = pricingContext!.candidates.filter(candidate => selectedIds.has(candidate.id));
            }

            let selectedReferenceIds: string[] = [];

            if (needsCommercialReview && referenceCandidates.length > 0) {
                const prompt = buildSupportAnalysisPrompt({
                    title: text(finding.title),
                    category: text(finding.category),
                    contractQuote: text(evidence.contract_quote),
                    workQuote: text(evidence.work_quote),
                    referenceCandidates,
                    priceCandidates,
                });
                const modelText = await generateComparisonText(prompt, execution, {responseFormat:SUPPORT_ANALYSIS_RESPONSE_SCHEMA});
                const modelResult = JSON.parse(modelText);
                selectedReferenceIds = selectRelevantSupportIds({
                    value: modelResult.reference_ids,
                    prefix: 'R',
                    candidates: referenceCandidates,
                    query,
                });
            }

            const selectedPriceItemIds = priceCandidates.map((_, index) => `P${index + 1}`);
            const checkedSummary = checkedSupportSummary(scopeReview, selectedReferenceIds.length);
            const impactSummary = checkedSummary.impact_summary;
            const recommendedAction = checkedSummary.recommended_action;

            const selectedReferences = selectedReferenceIds.map((id) =>
                referenceCandidates[Number(id.slice(1)) - 1]
            ).filter((candidate): candidate is SupportCandidate => Boolean(candidate));
            const selectedPrices = selectedPriceItemIds.map((id) =>
                priceCandidates[Number(id.slice(1)) - 1]
            ).filter((candidate): candidate is PricingScopeCandidate => Boolean(candidate));
            const supportAnalysis = {
                version: SUPPORT_ANALYSIS_VERSION,
                status: 'COMPLETE',
                source_signature: sourceSignature,
                context_signature: contextSignature,
                analyzed_at: new Date().toISOString(),
                impact_summary: impactSummary,
                recommended_action: recommendedAction,
                reference_evidence: selectedReferences.map(mapReferenceEvidence),
                price_evidence: selectedPrices.map(mapPriceEvidence),
                source_inventory: {
                    blue_book: references.some((row) => getReferenceType(row) === 'BLUE_BOOK')
                        || fallbackReferenceDocuments.some((row) => getReferenceType(row) === 'BLUE_BOOK'),
                    shelf_contract_3210: references.some((row) => getReferenceType(row) === 'SHELF_CONTRACT_3210')
                        || fallbackReferenceDocuments.some((row) => getReferenceType(row) === 'SHELF_CONTRACT_3210'),
                    price_lists: priceLists.map((row) => ({ id: row.id, name: row.name, status: row.parse_status || 'READY' })),
                },
                pricing_rule: 'PROJECT_BOQ_FIRST_THEN_APPLICABLE_OFFICIAL_PRICELIST',
                scope_review: scopeReview,
                scope_source_signature: scopeSignature,
                analysis_provider: identity.provider,
                analysis_model: identity.model,
            };
            const { error } = await supabase
                .from('contradictions')
                .update({
                    strategy_advice: recommendedAction,
                    evidence_data: { ...evidence, support_analysis: supportAnalysis },
                })
                .eq('id', finding.id)
                .eq('project_id', projectId);
            if (error) throw error;
        } catch (error: unknown) {
            await execution.checkActive();
            failed += 1;
            const message = error instanceof Error ? error.message : 'Support analysis failed';
            console.warn(`[scan:support] Failed to enrich ${finding.id}:`, message);
            const lastComplete = existingSupport.status === 'COMPLETE' ? existingSupport : existingSupport.last_complete || null;
            const result = await supabase.from('contradictions').update({ evidence_data: { ...evidence,
                support_analysis: { version: SUPPORT_ANALYSIS_VERSION, status: 'ERROR', source_signature: sourceSignature,
                    impact_summary: 'בדיקת המקורות לא הושלמה; התמחור נשאר לבדיקה.', recommended_action: text(finding.strategy_advice),
                    price_evidence: [], reference_evidence: [], error: message, last_complete: lastComplete } } })
                .eq('id', finding.id).eq('project_id', projectId);
            if (result.error) console.warn('[scan:support] Cannot save review limitation:', result.error.message);
        }

        processed += 1;
        await onProgress?.({ processed, total: findings.length, failed, currentTitle: text(finding.title) });
    }

    return {
        total: findings.length,
        processed,
        enriched: Math.max(0, processed - skipped - failed),
        skipped,
        failed,
        sourceSignature,
        inventory: {
            blueBook: references.some((row) => getReferenceType(row) === 'BLUE_BOOK')
                || fallbackReferenceDocuments.some((row) => getReferenceType(row) === 'BLUE_BOOK'),
            shelfContract3210: references.some((row) => getReferenceType(row) === 'SHELF_CONTRACT_3210')
                || fallbackReferenceDocuments.some((row) => getReferenceType(row) === 'SHELF_CONTRACT_3210'),
            priceLists: priceLists.map((row) => ({ id: row.id, name: row.name, status: row.parse_status || 'READY' })),
        },
    };
}
