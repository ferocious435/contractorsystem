import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { archiveContradictionRows, type ContradictionArchiveRow } from '@/utils/contradiction-archive';
import {
    canRemoveUnsupportedAutomaticFinding,
    findingNeedsHistory,
    isObsoleteAutomaticArchiveRow,
    type ReplaceableScanFinding,
} from '@/utils/scan-finding-retention-policy';
import {
    assessContractScanFinding,
    CONTRACT_SCAN_QUALITY_VERSION,
    findingHasActionableWorkEvidence,
    findSupersedingWorkEvidence,
    groundContractScanFinding,
    sourceVerificationMissingEvidence,
    type ContractScanFinding,
    reviewCompletionDeadlineBasis,
} from '@/utils/contract-scan-quality';
import { isTechnicalRadarExclusion } from '@/utils/radar-review-disposition';
import { isProjectContractBaseDocument, isReferenceDocument } from '@/utils/contract-document-hierarchy';
import { loadProjectBoundReferenceDocuments } from '@/utils/document-reference-authority-server';
import { contractSourcePointers, type BoundReferenceDocument } from '@/utils/bound-reference-comparison';
import { assessDocumentSourceReadiness, type DocumentSourceInput } from '@/utils/document-source-readiness';
import { reconcileSavedIssueRecords } from './radar-issue-reconciliation-server.ts';
import { buildRadarEvidenceAssessment, planSavedFindingReview } from './radar-saved-finding-review.ts';
export { reconcileSavedIssueRecords } from './radar-issue-reconciliation-server.ts';

export { findingNeedsHistory, type ReplaceableScanFinding } from '@/utils/scan-finding-retention-policy';
const REFERENCE_VERIFICATION_MISSING = 'לא ניתן לאמת כעת את ההפניה למסמך המקור';
const SOURCE_READING_INCOMPLETE = 'קריאת מסמך המקור לא הושלמה או שגרסתו דורשת בירור';

async function deleteFindingIds(supabase: SupabaseClient, ids: string[]) {
    const batchSize = 100;
    for (let offset = 0; offset < ids.length; offset += batchSize) {
        const batch = ids.slice(offset, offset + batchSize);
        const { error } = await supabase.from('contradictions').delete().in('id', batch);
        if (error) throw new Error(`Failed to delete obsolete automatic findings: ${error.message}`);
    }
}

async function refreshScanStateFindingCounts(
    supabase: SupabaseClient,
    projectId: string,
    signatures: string[],
) {
    for (const signature of [...new Set(signatures.filter(Boolean))]) {
        let count = 0;
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from('contradictions').select('id,evidence_data')
                .eq('project_id', projectId).eq('scan_signature', signature).neq('status', 'ARCHIVED').range(offset, offset + 499);
            if (error) throw error;
            count += (data || []).filter(item => !isTechnicalRadarExclusion(item)).length;
            if (!data || data.length < 500) break;
        }
        const { error: updateError } = await supabase
            .from('document_scan_state')
            .update({ findings_count: count || 0, updated_at: new Date().toISOString() })
            .eq('project_id', projectId)
            .eq('scan_signature', signature)
            .neq('findings_count', count);
        if (updateError) throw updateError;
    }
}

export async function replacePreviousScanFindings(params: {
    supabase: SupabaseClient;
    rows: ReplaceableScanFinding[];
    currentScanSignature: string;
}) {
    const { supabase, rows, currentScanSignature } = params;
    const preserved = rows.filter((row) => findingNeedsHistory(row)
        && !isLinkedPrimary(row) && !isTechnicalRadarExclusion(row));
    const obsoleteAutomatic = rows.filter((row) => !findingNeedsHistory(row));

    if (obsoleteAutomatic.length > 0) {
        await deleteFindingIds(supabase, obsoleteAutomatic.map((row) => row.id));
    }
    if (preserved.length > 0) {
        await archiveContradictionRows(supabase, preserved as ContradictionArchiveRow[], {
            archive_reason: 'A complete replacement scan finished successfully for this work document.',
            archived_at: new Date().toISOString(),
            current_scan_signature: currentScanSignature,
        });
    }

    return { deleted: obsoleteAutomatic.length, archived: preserved.length };
}

export async function deleteObsoleteAutomaticArchiveRows(
    supabase: SupabaseClient,
    projectId: string,
) {
    const [findingResult, documentResult] = await Promise.all([
        supabase.from('contradictions')
            .select('id, title, description, category, strategy_advice, source_execution_doc_id, target_contract_doc_id, evidence_data, scan_signature, pricing_status, status')
            .eq('project_id', projectId).eq('status', 'ARCHIVED').not('scan_signature', 'is', null),
        supabase.from('documents').select('id, title, category, extracted_text, parsed_json, ocr_status, storage_path, file_url').eq('project_id', projectId),
    ]);
    if (findingResult.error) throw findingResult.error;
    if (documentResult.error) throw documentResult.error;
    const documents = (documentResult.data || []) as StoredDocument[];
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const rows = (findingResult.data || []) as StoredFinding[];
    const contractDocuments = await storedComparisonDocuments(supabase, projectId, documents, rows);
    const obsoleteIds = rows.filter((row) => {
        if (!canRemoveUnsupportedAutomaticFinding(row)) return false;
        if (isObsoleteAutomaticArchiveRow(row)) return true;
        const metadata = asRecord(asRecord(row.evidence_data).archive_meta);
        // A documented resolution is project history, including when its original source later changes.
        if (metadata.resolution_document_id && metadata.resolution_quote) return false;
        const currentWorkDocument = documentsById.get(String(row.source_execution_doc_id || ''));
        if (!currentWorkDocument) return false;
        if (hasUnverifiedStoredReference(row, contractDocuments)) return false;
        const finding = groundStoredFinding(row, currentWorkDocument, contractDocuments);
        return !assessContractScanFinding({ finding, currentWorkDocument, contractDocuments }).accepted;
    }).map((row) => row.id);
    if (obsoleteIds.length > 0) await deleteFindingIds(supabase, obsoleteIds);
    return obsoleteIds.length;
}

type StoredFinding = ReplaceableScanFinding & {
    title?: string | null;
    description?: string | null;
    category?: string | null;
    strategy_advice?: string | null;
    source_execution_doc_id?: string | null;
    target_contract_doc_id?: string | null;
    created_at?: string | null;
};

type StoredDocument = DocumentSourceInput & {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
    parsed_json?: Record<string, unknown> | null;
    reference_authority?: BoundReferenceDocument['reference_authority'];
};

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isLinkedPrimary(row: ReplaceableScanFinding) {
    return asRecord(asRecord(row.evidence_data).issue_reconciliation).canonicalId === row.id;
}

function groundStoredFinding(row: StoredFinding, currentWorkDocument: StoredDocument, contractDocuments: StoredDocument[]) {
    const evidence = asRecord(row.evidence_data);
    const finding: ContractScanFinding = {
        title: row.title, description: row.description, category: row.category,
        advice: row.strategy_advice === `בצע ותעד: ${row.title}` ? null : row.strategy_advice,
        contract_quote: evidence.contract_quote, work_quote: evidence.work_quote,
        contract_document_id: asRecord(evidence.contract_reference_authority).reference_chunk_id || row.target_contract_doc_id,
        work_document_id: row.source_execution_doc_id,
        context_selection: evidence.context_selection,
        supplied_contract_document_ids: evidence.supplied_contract_document_ids,
        comparison: evidence.comparison,
    };
    return groundContractScanFinding({ finding, currentWorkDocument, contractDocuments });
}

async function storedComparisonDocuments(supabase: SupabaseClient, projectId: string, documents: StoredDocument[], rows: StoredFinding[]) {
    const base = documents.filter((document) => isProjectContractBaseDocument(document) && !isReferenceDocument(document));
    if (!rows.some((row) => asRecord(asRecord(row.evidence_data).contract_reference_authority).reference_chunk_id)) return base;
    try {
        return [...base, ...await loadProjectBoundReferenceDocuments({ supabase, projectId, documents: base })];
    } catch (error) {
        console.warn('[scan:retention] Reference sources unavailable; reference findings are retained for verification:', error);
        return base;
    }
}

function hasUnverifiedStoredReference(row: StoredFinding, documents: StoredDocument[]) {
    const sourceId = asRecord(asRecord(row.evidence_data).contract_reference_authority).reference_chunk_id;
    return Boolean(sourceId && !documents.some((document) => document.id === sourceId));
}

export async function consolidateRepeatedAutomaticFindings(
    supabase: SupabaseClient,
    projectId: string,
) {
    const result = await reconcileSavedIssueRecords(supabase, projectId, { apply: true });
    // Keep the response compatible; records are now linked and excluded, never deleted as repeats.
    return { groups: result.plans.length, deleted: 0, updated: result.updated,
        duplicates: result.duplicates, invalid: result.invalid };
}

export async function deleteUnsupportedAutomaticFindings(
    supabase: SupabaseClient,
    projectId: string,
    options: { reviewOnly?: boolean } = {},
) {
    const [findingResult, documentResult] = await Promise.all([
        supabase
            .from('contradictions')
            .select('id, title, description, category, strategy_advice, source_execution_doc_id, target_contract_doc_id, evidence_data, scan_signature, pricing_status, status')
            .eq('project_id', projectId)
            .neq('status', 'ARCHIVED')
            .not('scan_signature', 'is', null),
        supabase
            .from('documents')
            .select('id, title, category, extracted_text, parsed_json, ocr_status, storage_path, file_url')
            .eq('project_id', projectId),
    ]);
    if (findingResult.error) throw findingResult.error;
    if (documentResult.error) throw documentResult.error;

    const findings = (findingResult.data || []) as StoredFinding[];
    const documents = (documentResult.data || []) as StoredDocument[];
    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const contractDocuments = await storedComparisonDocuments(supabase, projectId, documents, findings);
    const invalid: StoredFinding[] = [];
    const invalidAssessments = new Map<string, ReturnType<typeof assessContractScanFinding>>();
    const archived: StoredFinding[] = [];
    const relatedWorkDocuments = documents.filter((document) =>
        !isProjectContractBaseDocument(document) && !isReferenceDocument(document)
        && assessDocumentSourceReadiness(document).canCompare);
    for (const row of findings) {
        if (!options.reviewOnly && isTechnicalRadarExclusion(row)) continue;
        if (!canRemoveUnsupportedAutomaticFinding(row)
            && !(isLinkedPrimary(row) && row.pricing_status !== 'PRICED' && row.status !== 'MOVED_TO_PRICING')) continue;
        if (options.reviewOnly && findingNeedsHistory(row)) continue;
        const evidence = asRecord(row.evidence_data);
        if (hasUnverifiedStoredReference(row, contractDocuments)) {
            if (evidence.evidence_status !== 'REQUIRES_VERIFICATION') {
                const missing = Array.isArray(evidence.missing_evidence) ? evidence.missing_evidence : [];
                const { error } = await supabase.from('contradictions').update({ evidence_data: { ...evidence,
                    evidence_status: 'REQUIRES_VERIFICATION',
                    missing_evidence: [...new Set([...missing, REFERENCE_VERIFICATION_MISSING])],
                    source_verification: { ...asRecord(evidence.source_verification), reference_chain_verified: false },
                } }).eq('id', row.id).eq('project_id', projectId);
                if (error) throw error;
            }
            continue;
        }
        const currentWorkDocument = documentsById.get(String(row.source_execution_doc_id || ''));
        if (!currentWorkDocument) {
            invalid.push(row);
            continue;
        }
        const finding = groundStoredFinding(row, currentWorkDocument, contractDocuments);
        const assessment = assessContractScanFinding({
            finding,
            currentWorkDocument,
            contractDocuments,
        });
        const sourceDocument = contractDocuments.find((document) => document.id === assessment.contractDocument?.id) || null;
        const sourcePointers = contractSourcePointers(sourceDocument);
        if (!assessment.accepted || !findingHasActionableWorkEvidence({ finding, currentWorkDocument, assessment })) {
            invalid.push(row);
            invalidAssessments.set(row.id, assessment);
            continue;
        }
        const sourceReadingComplete = assessDocumentSourceReadiness(currentWorkDocument).canCompare
            && (!sourceDocument || Boolean(sourcePointers.referenceAuthority)
                || assessDocumentSourceReadiness(sourceDocument).canCompare);
        const missingEvidence = Array.isArray(evidence.missing_evidence)
            ? evidence.missing_evidence.filter((item) => item !== REFERENCE_VERIFICATION_MISSING
                && !sourceVerificationMissingEvidence(['source_reading_incomplete', 'comparison_context_incomplete', 'unrelated_optional_contract_source']).includes(String(item))) : [];
        missingEvidence.push(...sourceVerificationMissingEvidence(assessment.verificationReasons));
        if (!sourceReadingComplete && !missingEvidence.includes(SOURCE_READING_INCOMPLETE)) missingEvidence.push(SOURCE_READING_INCOMPLETE);
        const nextEvidence: Record<string, unknown> = {
            ...evidence, work_quote: finding.work_quote, contract_quote: finding.contract_quote,
            source_repair_suggestions: finding.source_repair_suggestions || [],
            comparison_type: finding.comparison_type || evidence.comparison_type,
            contractual_reply_deadline: assessment.replyDeadline,
            missing_evidence: missingEvidence,
            contract_reference_authority: sourcePointers.referenceAuthority,
            contract_page: sourcePointers.referenceAuthority?.page || assessment.contractSourceAnchor?.page || null,
            work_page: assessment.workSourceAnchor?.page || null,
            contract_title: assessment.contractDocument?.title || null,
            contract_url: null,
            document_hierarchy_rule: sourcePointers.referenceAuthority ? 'incorporated_reference_with_project_precedence'
                : assessment.contractDocument ? 'contract_source_controls' : 'work_document_is_supporting_evidence',
            document_pair: {
                ...asRecord(evidence.document_pair),
                contract_doc_id: sourcePointers.displayDocumentId,
                contract_title: assessment.contractDocument?.title || null,
                work_doc_id: currentWorkDocument.id,
                work_title: currentWorkDocument.title || null,
            },
            ...buildRadarEvidenceAssessment(finding, assessment, evidence),
            evidence_status: sourceReadingComplete ? assessment.evidenceStatus : 'REQUIRES_VERIFICATION',
            source_verification: {
                ...buildRadarEvidenceAssessment(finding, assessment, evidence).source_verification,
                reference_chain_verified: Boolean(sourcePointers.referenceAuthority),
                source_reading_complete: sourceReadingComplete,
            },
        };
        if (options.reviewOnly) delete nextEvidence.review_disposition;
        const reviewedDeadline = options.reviewOnly ? reviewCompletionDeadlineBasis({ currentWorkDocument, documents }) : null;
        const deadlineReview = reviewedDeadline?.status !== 'NO_REFERENCED_DEADLINE' ? reviewedDeadline : null;
        if (deadlineReview) {
            nextEvidence.completion_deadline_review = deadlineReview;
            nextEvidence.missing_evidence = [...new Set([...missingEvidence, deadlineReview.summary])];
        }
        const sourceChanged = finding.contract_quote !== evidence.contract_quote
            || finding.work_quote !== evidence.work_quote
            || finding.contract_document_id !== (asRecord(evidence.contract_reference_authority).reference_chunk_id || row.target_contract_doc_id)
            || !isDeepStrictEqual(evidence.contract_reference_authority || null, sourcePointers.referenceAuthority);
        const categoryChanged = assessment.category !== row.category;
        if (options.reviewOnly || sourceChanged || categoryChanged || assessment.verificationReasons.includes('unrelated_optional_contract_source')) delete nextEvidence.support_analysis;
        const resolution = !options.reviewOnly && sourceReadingComplete ? findSupersedingWorkEvidence({ finding, currentWorkDocument, relatedWorkDocuments, contractDocuments }) : null;
        if (resolution) {
            await archiveContradictionRows(supabase, [{ ...row, evidence_data: nextEvidence }], {
                archive_reason: 'Resolved by later documented project evidence.',
                archived_at: new Date().toISOString(),
                resolution_document_id: resolution.documentId,
                resolution_document_title: resolution.documentTitle,
                resolution_quote: resolution.quote,
            });
            archived.push(row);
        } else if (options.reviewOnly || sourceChanged || categoryChanged || finding.advice !== row.strategy_advice
            || evidence.evidence_status !== nextEvidence.evidence_status
            || !isDeepStrictEqual(nextEvidence, evidence)
            || (sourcePointers.referenceAuthority && asRecord(evidence.source_verification).reference_chain_verified !== true)
            || asRecord(evidence.source_verification).quality_gate_version !== CONTRACT_SCAN_QUALITY_VERSION) {
            const { error } = await supabase.from('contradictions').update({
                evidence_data: nextEvidence,
                target_contract_doc_id: sourcePointers.targetContractDocumentId,
                strategy_advice: finding.advice,
                ...(categoryChanged || options.reviewOnly ? { category: assessment.category,
                    severity: assessment.category === 'סתירה' ? 'HIGH' : assessment.category === 'שינוי/חריג' ? 'MEDIUM' : 'LOW',
                    title: assessment.presentation.title,
                    description: deadlineReview ? `${assessment.presentation.description}\n\n${deadlineReview.summary}` : assessment.presentation.description } : {}),
            }).eq('id', row.id).eq('project_id', projectId);
            if (error) throw error;
        }
    }

    if (options.reviewOnly) {
        for (const row of invalid) {
            const plan = planSavedFindingReview({ finding: row, documents, contractDocuments });
            if (isDeepStrictEqual(row.evidence_data, plan.patch.evidence_data)) continue;
            const { error } = await supabase.from('contradictions').update({ evidence_data: plan.patch.evidence_data })
                .eq('id', row.id).eq('project_id', projectId);
            if (error) throw error;
        }
    } else if (invalid.length > 0) {
        const disposable = invalid.filter(canRemoveUnsupportedAutomaticFinding);
        if (disposable.length) await deleteFindingIds(supabase, disposable.map(row => row.id));
        for (const row of invalid.filter(isLinkedPrimary)) {
            const evidence = asRecord(row.evidence_data), assessment = invalidAssessments.get(row.id);
            const missing = Array.isArray(evidence.missing_evidence) ? evidence.missing_evidence : [];
            const next = { ...evidence, evidence_status: 'REQUIRES_VERIFICATION',
                missing_evidence: [...new Set([...missing, 'המקור הזמין אינו מוכיח עוד את הממצא השמור; היסטוריית הנושא נשמרה.'])],
                source_verification: { ...asRecord(evidence.source_verification), quality_gate_passed: false,
                    work_quote_matched: assessment?.workQuoteMatched ?? false,
                    contract_quote_matched: assessment?.contractQuoteMatched ?? false,
                    verification_reasons: assessment?.reasons || ['work_document_not_found'] },
            };
            if (isDeepStrictEqual(evidence, next)) continue;
            const { error } = await supabase.from('contradictions').update({ evidence_data: next }).eq('id', row.id).eq('project_id', projectId);
            if (error) throw error;
        }
    }

    const signatures = (options.reviewOnly ? findings : [...invalid, ...archived])
        .map((row) => row.scan_signature).filter((value): value is string => Boolean(value));
    await refreshScanStateFindingCounts(supabase, projectId, signatures);

    return options.reviewOnly ? invalid.length : invalid.filter(canRemoveUnsupportedAutomaticFinding).length;
}
