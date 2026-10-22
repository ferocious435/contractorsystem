import { assessContractScanFinding, groundContractScanFinding, CONTRACT_SCAN_QUALITY_VERSION,
    findingHasActionableWorkEvidence, sourceVerificationMissingEvidence, reviewCompletionDeadlineBasis,
    type ContractScanDocument, type ContractScanFinding } from './contract-scan-quality.ts';
import { assessDocumentSourceReadiness } from './document-source-readiness.ts';
import { findingNeedsHistory, type ReplaceableScanFinding } from './scan-finding-retention-policy.ts';
import { documentEventDate } from './radar-issue-history.ts';

export const SAVED_FINDING_REVIEW_VERSION = 'saved-finding-review-v1';
export type SavedReviewFinding = ReplaceableScanFinding & {
    title?: string | null; description?: string | null; category?: string | null; severity?: string | null;
    strategy_advice?: string | null; source_execution_doc_id?: string | null; target_contract_doc_id?: string | null;
    xmin?: string;
};
export function reviewRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
type QualityAssessment = ReturnType<typeof assessContractScanFinding>;

/** The same persisted assessment is used for generated and saved candidates. No model call. */
export function buildRadarEvidenceAssessment(finding: ContractScanFinding, assessment: QualityAssessment,
    previous: unknown = {}) {
    const evidence = reviewRecord(previous), context = reviewRecord(finding.context_selection);
    return {
        semantic_assessment: assessment.evidenceRelation,
        evidence_status: assessment.evidenceStatus,
        work_source_anchor: assessment.workSourceAnchor,
        contract_source_anchor: assessment.contractSourceAnchor,
        source_verification: {
            ...reviewRecord(evidence.source_verification),
            contract_quote_matched: assessment.contractQuoteMatched,
            work_quote_matched: assessment.workQuoteMatched,
            quality_gate_passed: assessment.accepted,
            quality_gate_version: CONTRACT_SCAN_QUALITY_VERSION,
            source_reading_complete: !assessment.verificationReasons.includes('source_reading_incomplete'),
            comparison_context_complete: context.complete !== false,
            verification_reasons: [...new Set([...assessment.reasons, ...assessment.verificationReasons])],
            semantic_relation: assessment.evidenceRelation.relation,
            semantic_assessment_version: assessment.evidenceRelation.version,
        },
    };
}

export function planSavedFindingReview(input: { finding: SavedReviewFinding; documents: ContractScanDocument[];
    contractDocuments: ContractScanDocument[] }) {
    const row = input.finding, evidence = reviewRecord(row.evidence_data);
    // Keep the proposed comparison kind stable when its displayed kind is downgraded.
    // Otherwise a rejected contradiction could pass on repeat merely as a generic event.
    const inputCategory = reviewRecord(evidence.finding_review).inputCategory || row.category || null;
    const canonicalId = String(reviewRecord(evidence.issue_link).canonicalId
        || reviewRecord(evidence.issue_reconciliation).canonicalId || row.id);
    const work = input.documents.find(document => document.id === row.source_execution_doc_id);
    const baselineId = reviewRecord(evidence.contract_reference_authority).reference_chunk_id || row.target_contract_doc_id;
    const raw: ContractScanFinding = { title: row.title, description: row.description, category: inputCategory,
        advice: row.strategy_advice === `בצע ותעד: ${row.title}` ? null : row.strategy_advice,
        work_quote: evidence.work_quote, contract_quote: evidence.contract_quote,
        work_document_id: row.source_execution_doc_id, contract_document_id: baselineId,
        comparison: evidence.comparison, context_selection: evidence.context_selection,
        supplied_contract_document_ids: evidence.supplied_contract_document_ids };
    const grounded = work ? groundContractScanFinding({ finding: raw, currentWorkDocument: work,
        contractDocuments: input.contractDocuments }) : null;
    const assessment = work && grounded ? assessContractScanFinding({ finding: grounded,
        currentWorkDocument: work, contractDocuments: input.contractDocuments }) : null;
    const actionable = Boolean(work && grounded && assessment && findingHasActionableWorkEvidence({
        finding: grounded, currentWorkDocument: work, assessment }));
    const baseline = input.contractDocuments.find(document => document.id === baselineId);
    const readingComplete = Boolean(work && assessDocumentSourceReadiness(work).canCompare
        && (!baselineId || (baseline && assessDocumentSourceReadiness(baseline).canCompare)));
    const reasons = [...new Set(assessment ? [...assessment.reasons, ...assessment.verificationReasons,
        ...assessment.evidenceRelation.reasons] : ['work_document_not_found'])];
    const semanticError = assessment?.evidenceRelation.resultType === 'NO_CONFLICT'
        && ['COMPATIBLE', 'DIFFERENT_SUBJECT'].includes(assessment.evidenceRelation.relation);
    const sourceError = assessment && (!assessment.workQuoteMatched
        || (Boolean(evidence.contract_quote && baseline) && !assessment.contractQuoteMatched));
    // Unknown meaning, incomplete reading and an unavailable reference require review;
    // none establishes that a project question is false.
    const provenError = Boolean(readingComplete && assessment && (semanticError || sourceError
        || assessment.reasons.includes('template_placeholder')));
    const primaryWithHistory = reviewRecord(evidence.issue_reconciliation).canonicalId === row.id;
    if (provenError && primaryWithHistory) reasons.push('primary_source_requires_review_history_retained');
    const outcome = provenError && !primaryWithHistory ? 'TECHNICAL_EXCLUSION'
        : assessment?.accepted && assessment.evidenceStatus === 'VERIFIED' && actionable ? 'CONFIRMED'
            : 'REQUIRES_REVIEW';
    const manual = Boolean(evidence.manual_review || evidence.user_review || evidence.approved_by_user || !row.scan_signature);
    const protectedContent = manual || findingNeedsHistory(row);
    const originalContext = reviewRecord(evidence.context_selection);
    const originalModelContextRecorded = Object.keys(originalContext).length > 0;
    const nextEvidence: Record<string, unknown> = { ...evidence,
        ...(assessment && grounded ? buildRadarEvidenceAssessment(grounded, assessment, evidence)
            : { evidence_status: 'REQUIRES_VERIFICATION', source_verification: { ...reviewRecord(evidence.source_verification),
                quality_gate_passed: false, work_quote_matched: false, verification_reasons: reasons } }),
        finding_review: { version: SAVED_FINDING_REVIEW_VERSION, outcome, reasons, canonicalId, inputCategory,
            evidenceDate: work ? documentEventDate(work).date : null,
            retainedUserContent: protectedContent,
            sourceContext: {
                version: 'saved-source-context-v1', selectionReason: 'existing_record_source_links',
                workDocumentId: row.source_execution_doc_id || null, baselineDocumentId: baselineId || null,
                originalModelContextRecorded,
                anchors: assessment?.evidenceRelation.sourceAnchors || [],
                limitations: [...new Set([
                    ...(assessment?.verificationReasons || ['work_document_not_found']),
                    ...(Array.isArray(originalContext.limitations)
                        ? originalContext.limitations.filter((value): value is string => typeof value === 'string') : []),
                    ...(!originalModelContextRecorded ? ['original_model_context_not_recorded'] : []),
                ])],
            } },
    };
    if (outcome !== 'CONFIRMED') nextEvidence.evidence_status = 'REQUIRES_VERIFICATION';
    const disposition = reviewRecord(evidence.review_disposition);
    if (outcome === 'TECHNICAL_EXCLUSION' && !manual && disposition.type !== 'DUPLICATE') {
        nextEvidence.review_disposition = { ...disposition, type: 'INVALID_AUTOMATIC_FINDING',
            checked_version: CONTRACT_SCAN_QUALITY_VERSION, reasons, ...(canonicalId !== row.id ? { canonical_id: canonicalId } : {}) };
    } else if (assessment?.accepted && readingComplete && !semanticError && disposition.type === 'INVALID_AUTOMATIC_FINDING') {
        delete nextEvidence.review_disposition;
    }
    const missing = Array.isArray(evidence.missing_evidence) ? evidence.missing_evidence : [];
    nextEvidence.missing_evidence = [...new Set([...missing, ...sourceVerificationMissingEvidence(reasons)])];
    const deadline = work ? reviewCompletionDeadlineBasis({ currentWorkDocument: work, documents: input.documents }) : null;
    if (deadline && deadline.status !== 'NO_REFERENCED_DEADLINE') {
        nextEvidence.completion_deadline_review = deadline;
        nextEvidence.missing_evidence = [...new Set([...(nextEvidence.missing_evidence as unknown[]), deadline.summary])];
    }
    const patch: Record<string, unknown> & { evidence_data: Record<string, unknown> } = { evidence_data: nextEvidence };
    if (assessment && !protectedContent && !provenError) {
        patch.category = outcome === 'CONFIRMED' ? assessment.category
            : assessment.evidenceRelation.resultType === 'KNOWN_CHANGE' ? 'שינוי/חריג'
                : assessment.evidenceRelation.resultType === 'EVENT' ? 'אירוע שטח' : 'חוסר נתונים';
        patch.title = assessment.presentation.title;
        patch.description = `${assessment.presentation.description}${deadline && deadline.status !== 'NO_REFERENCED_DEADLINE' ? `\n\n${deadline.summary}` : ''}`;
        // Importance is independent of the finding's kind.
    }
    return { id: row.id, canonicalId, outcome, reasons, patch, assessment,
        preserved: { status: row.status, pricingStatus: row.pricing_status,
            sourceDocumentId: row.source_execution_doc_id, baselineDocumentId: row.target_contract_doc_id } };
}
