import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isProjectContractBaseDocument, isReferenceDocument } from './contract-document-hierarchy.ts';
import { loadProjectBoundReferenceDocuments } from './document-reference-authority-server.ts';
import { isTechnicalRadarExclusion } from './radar-review-disposition.ts';
import { loadIssueFinancialRecords } from './radar-issue-reconciliation-server.ts';
import { planSavedFindingReview, reviewRecord, type SavedReviewFinding } from './radar-saved-finding-review.ts';
import type { ContractScanDocument } from './contract-scan-quality.ts';

async function allRows(build: (start: number, end: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const rows: Record<string, unknown>[] = [];
    for (let start = 0; ; start += 500) {
        const result = await build(start, start + 499);
        if (result.error) throw new Error(result.error.message);
        const batch = (result.data || []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < 500) return rows;
    }
}

/** Explicit targets or current questions plus their linked historical records. Never the whole archive. */
export async function reviewSavedRadarFindings(supabase: SupabaseClient, projectId: string,
    options: { findingIds?: string[]; apply?: boolean; reviewToken?: string } = {}) {
    if (options.findingIds && (!options.findingIds.length || options.findingIds.length > 100
        || options.findingIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Invalid saved review scope');
    const [allFindings, rawDocuments] = await Promise.all([
        allRows((a,b) => supabase.from('contradictions').select('*,xmin').eq('project_id', projectId).order('id').range(a,b)),
        allRows((a,b) => supabase.from('documents').select('id,title,category,extracted_text,parsed_json,ocr_status,storage_path,file_url')
            .eq('project_id', projectId).order('id').range(a,b)),
    ]);
    const activeStatus = (row: { status?: unknown }) => row.status === 'OPEN' || row.status === 'MOVED_TO_PRICING';
    const selected = new Set(options.findingIds || allFindings.filter(activeStatus).flatMap(row => {
        const links = reviewRecord(reviewRecord(row.evidence_data).issue_reconciliation).linkRelatedRecordIds;
        return [String(row.id), ...(Array.isArray(links) ? links.filter((id): id is string => typeof id === 'string') : [])];
    }));
    const findings = allFindings.filter(row => selected.has(String(row.id))) as SavedReviewFinding[];
    if (findings.length !== selected.size) throw new Error('A saved finding was not found in the owned project');
    const documents = rawDocuments as (ContractScanDocument & { parsed_json?: Record<string,unknown> | null })[];
    let contractDocuments = documents.filter(doc => isProjectContractBaseDocument(doc) && !isReferenceDocument(doc));
    if (findings.some(row => reviewRecord(reviewRecord(row.evidence_data).contract_reference_authority).reference_chunk_id)) {
        try { contractDocuments = [...contractDocuments, ...await loadProjectBoundReferenceDocuments({ supabase, projectId, documents: contractDocuments })]; }
        catch { /* The missing baseline remains an explicit verification gap. */ }
    }
    const finance = await loadIssueFinancialRecords(supabase, projectId, findings.map(row => row.id));
    const reviewToken = createHash('sha256').update(JSON.stringify({ findings, documents, contractDocuments, links: finance.links })).digest('hex');
    if (options.apply && options.reviewToken !== reviewToken) throw new Error('Saved findings or sources changed; preview the current proposal before applying it.');
    const plans = findings.map(finding => planSavedFindingReview({ finding, documents, contractDocuments }));
    let updated = 0;
    if (options.apply) {
        for (let i = 0; i < plans.length; i++) {
            const plan = plans[i], row = findings[i];
            if (Object.entries(plan.patch).every(([key,value]) => isDeepStrictEqual((row as Record<string,unknown>)[key], value))) continue;
            if (!/^\d+$/.test(String(row.xmin || ''))) throw new Error('Saved finding version could not be read; no overwrite is allowed.');
            const { data, error } = await supabase.from('contradictions').update(plan.patch)
                .eq('project_id',projectId).eq('id',row.id).eq('xmin',row.xmin).select('id');
            if (error) throw new Error(error.message);
            if (!data?.length) throw new Error('A saved finding changed during review; reload before continuing.');
            updated++;
        }
        const signatures = [...new Set(findings.map(row => row.scan_signature).filter((s): s is string => Boolean(s)))];
        for (const signature of signatures) {
            const current = await allRows((a,b) => supabase.from('contradictions').select('id,status,evidence_data')
                .eq('project_id',projectId).eq('scan_signature',signature).order('id').range(a,b));
            const count = current.filter(row => activeStatus(row) && !isTechnicalRadarExclusion(row)).length;
            const { error } = await supabase.from('document_scan_state').update({ findings_count: count, updated_at: new Date().toISOString() })
                .eq('project_id',projectId).eq('scan_signature',signature).neq('findings_count',count);
            if (error) throw new Error(error.message);
        }
    }
    const visiblePlans = plans.filter((p,index) => activeStatus(findings[index])
        && !isTechnicalRadarExclusion({ evidence_data:p.patch.evidence_data }));
    return { reviewToken, findingIds: findings.map(row => row.id), plans, updated, financialLinks: finance.links,
        confirmed: visiblePlans.filter(p => p.outcome === 'CONFIRMED').length,
        requiresReview: visiblePlans.filter(p => p.outcome !== 'CONFIRMED').length,
        excluded: plans.filter(p => isTechnicalRadarExclusion({ evidence_data: p.patch.evidence_data })).length };
}
