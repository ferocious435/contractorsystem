import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/app/api/_utils/auth';
import { createClient } from '@/utils/supabase/server';
import { enrichProjectFindingsWithSupportSources } from '@/utils/support-source-enrichment-server';

export const maxDuration = 600;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const projectId = String(body?.projectId || '').trim();
        if (!projectId) {
            return NextResponse.json({ success: false, error: 'projectId is required' }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);
        if (!ownership.ok) return ownership.response;

        const result = await enrichProjectFindingsWithSupportSources({ supabase, projectId });
        return NextResponse.json({ success: result.failed === 0, ...result });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Support analysis failed';
        console.error('[scan:enrich] API error:', error);
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
