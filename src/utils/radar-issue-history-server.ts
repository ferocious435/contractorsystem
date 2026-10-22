import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { buildIssueHistory, documentEventDate, isMtmIssueText, ISSUE_HISTORY_VERSION, MTM_ISSUE, type IssueHistoryAssessment, type IssueHistoryDocument, type IssueOwnerNote } from './radar-issue-history.ts';
import { isTechnicalRadarExclusion } from './radar-review-disposition.ts';
import { reviewIssueTiming } from './radar-issue-timing.ts';
import { mayReferenceAdvanceDeadline, reviewCompletionDeadlineBasis } from './completion-deadline-review.ts';

type IssueRow = { id: string; title?: string | null; evidence_data?: unknown };
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function savedIssueHistory(row: IssueRow, documents: IssueHistoryDocument[]) {
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
    const sourceSignature = createHash('sha256').update(JSON.stringify({ version: ISSUE_HISTORY_VERSION,
        timingAlgorithm: 'own-header-date-v2', location,
        documents: related.map(document => ({ id: document.id, title: document.title, text: document.extracted_text,
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
    const timing = reviewIssueTiming({ issue: history.issue, documents: related, asOf });
    const completionSource = related.find(document => /מקדמה/u.test(String(document.extracted_text || ''))
        && /להשל[ימ]|השלמת|מועד סיום/u.test(String(document.extracted_text || '')));
    const completionBasis = completionSource ? reviewCompletionDeadlineBasis({ currentWorkDocument: completionSource,
        documents: documents.filter(document => !mayReferenceAdvanceDeadline(document)
            || (documentEventDate(document).date || '') <= asOf) }) : null;
    // The state describes the available period, not today's signature status.
    return { ...history, asOf, sourceSignature, timing, completionBasis,
        closed: history.closed && timing.confirmedConflicts.length === 0 };
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
    let updated = 0;
    for (const row of candidates) {
        const evidence = record(row.evidence_data), history = savedIssueHistory(row, documents);
        if (!history || isDeepStrictEqual(evidence.issue_history, history)) continue;
        const { error: updateError } = await supabase.from('contradictions')
            .update({ evidence_data: { ...evidence, issue_history: history } }).eq('project_id', projectId).eq('id', row.id);
        if (updateError) throw updateError;
        updated += 1;
    }
    return { updated };
}
