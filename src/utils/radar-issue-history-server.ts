import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { buildIssueHistory, documentEventDate, isMtmIssueText, ISSUE_HISTORY_VERSION, MTM_ISSUE, type IssueHistoryAssessment, type IssueHistoryDocument, type IssueOwnerNote } from './radar-issue-history.ts';
import { isTechnicalRadarExclusion } from './radar-review-disposition.ts';
import { reviewIssueTiming } from './radar-issue-timing.ts';
import { mayReferenceAdvanceDeadline, reviewCompletionDeadlineBasis } from './completion-deadline-review.ts';
import { loadProjectComparisonReferenceContext } from './document-reference-authority-server.ts';
import type { DocumentReferenceGraph } from './document-reference-authority.ts';
import { isRequirementContractSource } from './radar-requirement-context.ts';
import { reviewIssueRequirements, REQUIREMENT_REVIEW_VERSION } from './radar-requirement-review.ts';

type IssueRow = { id: string; title?: string | null; evidence_data?: unknown };
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

type ReferenceContext = { graph?: DocumentReferenceGraph; signature?: string; projectId?: string };
export function savedIssueHistory(row: IssueRow, documents: IssueHistoryDocument[], referenceContext: ReferenceContext = {}) {
    const evidence = record(row.evidence_data);
    if (isTechnicalRadarExclusion(row) || !isMtmIssueText(`${row.title || ''} ${evidence.work_quote || ''}`)) return null;
    const notes = Array.isArray(evidence.issue_owner_notes) ? evidence.issue_owner_notes.filter(note => {
        const value = record(note);
        return value.origin === 'OWNER_NOTE' && typeof value.id === 'string' && typeof value.text === 'string'
            && ['METHOD', 'SIGNATURE', 'PRICE'].includes(String(value.aspect));
    }) as IssueOwnerNote[] : [];
    const location = String(evidence.work_quote || '').match(/(?:ברחוב|רחוב)\s+([\p{L}״"'-]+)/u)?.[1] || MTM_ISSUE.location;
    const related = documents.filter(document => isMtmIssueText(String(document.extracted_text || ''))
        || mayReferenceAdvanceDeadline(document));
    const basisDocuments = [...new Map([...related, ...documents.filter(isRequirementContractSource)]
        .map(document => [document.id, document])).values()];
    const sourceSignature = createHash('sha256').update(JSON.stringify({ version: ISSUE_HISTORY_VERSION,
        timingAlgorithm: 'own-header-date-v2', requirementReviewVersion: REQUIREMENT_REVIEW_VERSION,
        referenceSignature: referenceContext.signature || (referenceContext.graph
            ? createHash('sha256').update(JSON.stringify(referenceContext.graph)).digest('hex') : null), location,
        documents: basisDocuments.map(document => ({ id: document.id, title: document.title, text: document.extracted_text,
            category: document.category,
            ocr: document.ocr_status, storage: document.storage_path, url: document.file_url,
            reading: record(document.parsed_json).source_reading })).sort((a, b) => a.id.localeCompare(b.id)), notes })).digest('hex');
    const previous = record(evidence.issue_history), today = new Date().toISOString().slice(0, 10);
    if (previous.sourceSignature === sourceSignature && previous.version === ISSUE_HISTORY_VERSION
        && (!previous.nextEffectiveDate || String(previous.nextEffectiveDate) > today)) {
        return previous as IssueHistoryAssessment & { sourceSignature: string };
    }
    const history = buildIssueHistory({ issue: { subject: 'MTM', location }, documents: related,
        ownerNotes: notes, asOf: today });
    const asOf = history.evidenceThrough || today;
    const requirementReview = reviewIssueRequirements({ issue: history.issue, documents,
        referenceGraph: referenceContext.graph, asOf });
    const timing = reviewIssueTiming({ issue: history.issue, documents: related, asOf, requirementReview });
    const completionSource = related.find(document => /מקדמה/u.test(String(document.extracted_text || ''))
        && /להשל[ימ]|השלמת|מועד סיום/u.test(String(document.extracted_text || '')));
    const completionBasis = completionSource ? reviewCompletionDeadlineBasis({ currentWorkDocument: completionSource,
        documents: documents.filter(document => !mayReferenceAdvanceDeadline(document)
            || (documentEventDate(document).date || '') <= asOf) }) : null;
    // The state describes the available period, not today's signature status.
    return { ...history, asOf, sourceSignature, timing, requirementReview, completionBasis, projectId: referenceContext.projectId,
        closed: history.closed && timing.confirmedConflicts.length === 0 && requirementReview.confirmedConflicts.length === 0 };
}

export async function refreshSavedIssueHistories(supabase: SupabaseClient, projectId: string, suppliedDocuments?: IssueHistoryDocument[]) {
    const { data: rows, error } = await supabase.from('contradictions').select('id,title,evidence_data')
        .eq('project_id', projectId).neq('status', 'ARCHIVED');
    if (error) throw error;
    const candidates = (rows || []).filter(row => !isTechnicalRadarExclusion(row)
        && isMtmIssueText(`${row.title || ''} ${record(row.evidence_data).work_quote || ''}`));
    if (!candidates.length) return { updated: 0 };
    let documents = suppliedDocuments;
    if (!documents) {
        const result = await supabase.from('documents').select('id,title,category,extracted_text,parsed_json,ocr_status,storage_path,file_url')
            .eq('project_id', projectId);
        if (result.error) throw result.error;
        documents = result.data || [];
    }
    let referenceContext: ReferenceContext = { projectId };
    try {
        referenceContext = { ...await loadProjectComparisonReferenceContext({ supabase, projectId,
            documents: documents.filter(isRequirementContractSource).map(document => ({ ...document, parsed_json: record(document.parsed_json) })) }), projectId };
    } catch (error) {
        // A missing library cannot turn a request into a valid instruction. The
        // pure assessment retains a concrete reference_context_unavailable gap.
        console.warn('[radar history] Reference authority context unavailable:', error instanceof Error ? error.message : 'unknown error');
    }
    let updated = 0;
    for (const row of candidates) {
        const evidence = record(row.evidence_data), history = savedIssueHistory(row, documents, referenceContext);
        if (!history || isDeepStrictEqual(evidence.issue_history, history)) continue;
        const { error: updateError } = await supabase.from('contradictions')
            .update({ evidence_data: { ...evidence, issue_history: history } }).eq('project_id', projectId).eq('id', row.id);
        if (updateError) throw updateError;
        updated += 1;
    }
    return { updated };
}
