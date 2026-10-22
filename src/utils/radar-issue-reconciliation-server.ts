import type { SupabaseClient } from '@supabase/supabase-js';
import { isDeepStrictEqual } from 'node:util';
import { isTechnicalRadarExclusion } from './radar-review-disposition.ts';
import { planIssueReconciliation, reconciliationRecord, type IssueFinancialLink, type IssueReconciliationPlan,
    type ReconciliationDocument, type ReconciliationFinding } from './radar-issue-reconciliation.ts';

async function rows(query: { then: PromiseLike<{ data: unknown; error: { message: string } | null }>['then'] }) {
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data as Record<string, unknown>[] || [];
}
async function allRows(build: (start: number, end: number) => Parameters<typeof rows>[0]) {
    const found: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
        const batch = await rows(build(offset, offset + 499));
        found.push(...batch);
        if (batch.length < 500) return found;
    }
}
async function batches(ids: string[], build: (batch: string[], start: number, end: number) => Parameters<typeof rows>[0]) {
    const found = new Map<string, Record<string, unknown>>();
    for (let offset = 0; offset < ids.length; offset += 100) {
        for (const row of await allRows((start, end) => build(ids.slice(offset, offset + 100), start, end))) found.set(String(row.id), row);
    }
    return [...found.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export async function loadIssueFinancialRecords(supabase: SupabaseClient, projectId: string, findingIds: string[]) {
    const ledger = await batches(findingIds, (batch, start, end) => supabase.from('pricing_ledger').select('*')
        .eq('project_id', projectId).in('contradiction_id', batch).order('id').range(start, end));
    const items = await batches(ledger.map(item => String(item.id)), (batch, start, end) => supabase.from('vo_letter_items').select('*')
        .in('ledger_item_id', batch).order('id').range(start, end));
    const letters = await batches([...new Set(items.map(item => String(item.letter_id)))], (batch, start, end) => supabase.from('vo_letters').select('*')
        .eq('project_id', projectId).in('id', batch).order('id').range(start, end));
    const links: IssueFinancialLink[] = ledger.map(item => ({ findingId: String(item.contradiction_id), ledgerId: String(item.id),
        letterIds: [...new Set(items.filter(link => link.ledger_item_id === item.id && letters.some(letter => letter.id === link.letter_id))
            .map(link => String(link.letter_id)))].sort() }));
    return { ledger, letters, links };
}

export async function loadIssueReconciliationPlans(supabase: SupabaseClient, projectId: string, seedId?: string) {
    const [findings, documents] = await Promise.all([
        allRows((start, end) => supabase.from('contradictions').select('*,xmin').eq('project_id', projectId).order('id').range(start, end)),
        allRows((start, end) => supabase.from('documents').select('id,title,category,extracted_text,parsed_json,ocr_status,storage_path,file_url')
            .eq('project_id', projectId).order('id').range(start, end)),
    ]);
    if (seedId && !findings.some(row => row.id === seedId)) throw new Error('Issue was not found in the owned project');
    const financial = await loadIssueFinancialRecords(supabase, projectId, findings.map(row => String(row.id)));
    const plans: IssueReconciliationPlan[] = [], included = new Set<string>();
    for (const row of findings) {
        if ((seedId && row.id !== seedId) || included.has(String(row.id))) continue;
        const evidence = reconciliationRecord(row.evidence_data);
        if (reconciliationRecord(evidence.review_disposition).type === 'INVALID_AUTOMATIC_FINDING' && !seedId) continue;
        const plan = planIssueReconciliation({ seedId: String(row.id), findings: findings as ReconciliationFinding[],
            documents: documents as ReconciliationDocument[], financialLinks: financial.links });
        if (!plan.canonicalId || !plan.linkRelatedRecordIds.length) continue;
        plans.push(plan);
        [plan.canonicalId, ...plan.linkRelatedRecordIds].forEach(id => included.add(id));
    }
    return { plans, findings: findings as ReconciliationFinding[], documents: documents as ReconciliationDocument[] };
}

async function saveEvidence(supabase: SupabaseClient, projectId: string, row: ReconciliationFinding, evidence: Record<string, unknown>) {
    if (isDeepStrictEqual(row.evidence_data, evidence)) return false;
    // PostgreSQL supplies a version for every row without a schema change. A short
    // version filter also avoids placing a potentially huge document history in a URL.
    if (!/^\d+$/.test(String(row.xmin || ''))) throw new Error('The issue row version could not be read; no changes were applied.');
    const { data, error } = await supabase.from('contradictions').update({ evidence_data: evidence })
        .eq('project_id', projectId).eq('id', row.id)
        .eq('xmin', row.xmin).select('id,xmin');
    if (error) throw new Error(`Failed to save issue links: ${error.message}`);
    if (!data?.length) throw new Error('Issue changed during reconciliation; no related record was marked. Repeat the saved-evidence review.');
    row.evidence_data = evidence;
    row.xmin = String(data[0].xmin);
    return true;
}

/** Save the full checked history first; mark child records only after that succeeds. */
export async function reconcileSavedIssueRecords(supabase: SupabaseClient, projectId: string,
    options: { seedId?: string; apply?: boolean } = {}) {
    const { plans, findings } = await loadIssueReconciliationPlans(supabase, projectId, options.seedId);
    if (!options.apply) return { plans, updated: 0, duplicates: 0, invalid: 0 };
    const byId = new Map(findings.map(row => [row.id, row]));
    const affectedSignatures = new Set<string>();
    let updated = 0, duplicates = 0, invalid = 0;
    for (const plan of plans) {
        const primary = byId.get(plan.canonicalId!)!;
        const primaryEvidence = { ...reconciliationRecord(primary.evidence_data), issue_reconciliation: plan } as Record<string, unknown>;
        if (reconciliationRecord(primaryEvidence.review_disposition).type === 'DUPLICATE') delete primaryEvidence.review_disposition;
        delete primaryEvidence.issue_link;
        if (await saveEvidence(supabase, projectId, primary, primaryEvidence)) updated++;
        for (const id of plan.linkRelatedRecordIds) {
            const row = byId.get(id)!, evidence = reconciliationRecord(row.evidence_data);
            const problem = plan.flagInvalidEvidence.find(item => item.findingId === id);
            const duplicate = plan.markDuplicates.includes(id);
            if ((problem || duplicate) && row.scan_signature && row.status !== 'ARCHIVED') affectedSignatures.add(row.scan_signature);
            const next: Record<string, unknown> = { ...evidence, issue_link: { version: plan.version, canonicalId: plan.canonicalId,
                relation: problem ? 'INVALID_EVIDENCE' : duplicate ? 'REPEAT' : 'RELATED_CONDITION' } };
            if (problem || duplicate) next.review_disposition = { ...reconciliationRecord(evidence.review_disposition),
                type: problem ? 'INVALID_AUTOMATIC_FINDING' : 'DUPLICATE', canonical_id: plan.canonicalId,
                review_version: plan.version, reasons: [problem?.reason || 'SAME_ISSUE_SAME_CONDITION_AND_BASIS'] };
            if (problem) {
                next.evidence_status = 'REQUIRES_VERIFICATION';
                next.source_verification = { ...reconciliationRecord(evidence.source_verification),
                    work_quote_matched: problem.reason === 'WORK_QUOTE_NOT_FOUND' || problem.reason === 'WORK_DOCUMENT_NOT_FOUND' ? false
                        : reconciliationRecord(evidence.source_verification).work_quote_matched ?? null,
                    quality_gate_passed: false };
            }
            if (await saveEvidence(supabase, projectId, row, next)) {
                updated++;
                if (problem) invalid++;
                if (duplicate) duplicates++;
            }
        }
    }
    for (const signature of affectedSignatures) {
        const current = await allRows((start, end) => supabase.from('contradictions').select('id,evidence_data')
            .eq('project_id', projectId).eq('scan_signature', signature).neq('status', 'ARCHIVED').order('id').range(start, end));
        const count = current.filter(row => !isTechnicalRadarExclusion(row)).length;
        const { error } = await supabase.from('document_scan_state').update({ findings_count: count, updated_at: new Date().toISOString() })
            .eq('project_id', projectId).eq('scan_signature', signature).neq('findings_count', count);
        if (error) throw error;
    }
    return { plans, updated, duplicates, invalid };
}
