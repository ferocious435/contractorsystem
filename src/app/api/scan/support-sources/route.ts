import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/app/api/_utils/auth';
import { createClient } from '@/utils/supabase/server';
import { loadProjectReferenceAuthority, REFERENCE_AUTHORITY_DOCUMENT_COLUMNS } from '@/utils/document-reference-authority-server';
import { buildDocumentReferenceCheckReport } from '@/utils/document-reference-authority';
import { buildBoundReferenceDocuments } from '@/utils/bound-reference-comparison';
import {
    buildSupportSourceInventory,
    type PriceListSourceRow,
    type ReferenceSourceRow,
    type SupportSourceDocument,
} from '@/utils/support-source-inventory';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const projectId = new URL(req.url).searchParams.get('projectId');
        if (!projectId) {
            return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);
        if (!ownership.ok) return ownership.response;

        const [documentsResult, referencesResult, priceListsResult] = await Promise.all([
            supabase
                .from('documents')
                .select(REFERENCE_AUTHORITY_DOCUMENT_COLUMNS)
                .eq('project_id', projectId),
            supabase
                .from('reference_documents')
                .select('id, title, reference_type, authority_scope, status, page_count, source_document_id, text_hash')
                .or(`project_id.eq.${projectId},project_id.is.null`),
            supabase
                .from('pricelists')
                .select('id, name, project_id, is_global, source_type, version_label, publisher, parse_status')
                .or(`project_id.eq.${projectId},project_id.is.null,is_global.eq.true`),
        ]);

        if (documentsResult.error) throw documentsResult.error;
        if (referencesResult.error) throw referencesResult.error;
        if (priceListsResult.error) throw priceListsResult.error;

        const inventory = buildSupportSourceInventory({
            documents: (documentsResult.data || []) as SupportSourceDocument[],
            references: (referencesResult.data || []) as ReferenceSourceRow[],
            priceLists: (priceListsResult.data || []) as PriceListSourceRow[],
        });

        let referenceChecks;
        try {
            const authority = await loadProjectReferenceAuthority({ supabase, projectId,
                documents: documentsResult.data || [], references: referencesResult.data || [] });
            const report = buildDocumentReferenceCheckReport(authority.graph);
            referenceChecks = { ...report, checkedAt: new Date().toISOString(), sourceSignature: authority.signature,
                eligibleComparisonPages: buildBoundReferenceDocuments(authority.graph).length,
                issueCount: report.issues.length, issues: report.issues.slice(0, 100),
                issuesTruncated: report.issues.length > 100 };
        } catch (error) {
            console.warn('[scan:support-sources] Reference checks failed:', error);
            referenceChecks = { error: 'Reference source verification could not be completed', references: [] };
        }
        return NextResponse.json({ success: true, ...inventory, referenceChecks });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to load support sources';
        console.error('[scan:support-sources] Inventory error:', error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
