import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireOwnedProject } from '@/app/api/_utils/auth';
import { loadIssueFinancialRecords } from '@/utils/radar-issue-reconciliation-server';
import { reconciliationRecord } from '@/utils/radar-issue-reconciliation';

export async function GET(request: NextRequest) {
    try {
        const projectId = request.nextUrl.searchParams.get('projectId');
        const findingId = request.nextUrl.searchParams.get('findingId');
        if (!projectId || !findingId) return NextResponse.json({ success: false, error: 'projectId and findingId are required' }, { status: 400 });
        const supabase = await createClient(), ownership = await requireOwnedProject(supabase, projectId);
        if (!ownership.ok) return ownership.response;
        const { data: row, error } = await supabase.from('contradictions').select('id,evidence_data')
            .eq('project_id', projectId).eq('id', findingId).maybeSingle();
        if (error) throw error;
        if (!row) return NextResponse.json({ success: false, error: 'Issue was not found' }, { status: 404 });
        const plan = reconciliationRecord(reconciliationRecord(row.evidence_data).issue_reconciliation);
        const linked = Array.isArray(plan.linkRelatedRecordIds) ? plan.linkRelatedRecordIds.filter((id): id is string => typeof id === 'string') : [];
        const records = await loadIssueFinancialRecords(supabase, projectId, [row.id, ...linked]);
        return NextResponse.json({ success: true, ledger: records.ledger, letters: records.letters }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        console.error('[radar linked records]', error);
        return NextResponse.json({ success: false, error: 'לא ניתן לפתוח כעת את הרישומים השמורים' }, { status: 500 });
    }
}
