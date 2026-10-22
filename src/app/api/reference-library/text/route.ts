import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/app/api/_utils/auth';
import { createClient } from '@/utils/supabase/server';
import { renderReferencePage } from '@/utils/reference-page-preview';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const search = new URL(req.url).searchParams;
    const projectId = search.get('projectId');
    const referenceId = search.get('referenceId');
    const page = Number(search.get('page') || 1);
    if (!projectId || !referenceId || !Number.isSafeInteger(page) || page < 1) {
        return NextResponse.json({ error: 'Valid projectId, referenceId and page are required' }, { status: 400 });
    }
    const supabase = await createClient();
    const ownership = await requireOwnedProject(supabase, projectId);
    if (!ownership.ok) return ownership.response;
    const { data: reference, error } = await supabase.from('reference_documents')
        .select('id, title, page_count').eq('id', referenceId).eq('status', 'READY')
        .or(`project_id.eq.${projectId},project_id.is.null`).maybeSingle();
    if (error) return NextResponse.json({ error: 'Could not read reference document' }, { status: 500 });
    if (!reference) return NextResponse.json({ error: 'Reference document not found' }, { status: 404 });
    const { data: chunks, error: chunkError } = await supabase.from('reference_document_chunks')
        .select('text').eq('reference_document_id', referenceId).eq('page_from', page)
        .neq('chunk_type', 'DOCUMENT').order('ordinal');
    if (chunkError) return NextResponse.json({ error: 'Could not read reference page' }, { status: 500 });
    if (!chunks?.length) return NextResponse.json({ error: 'Reference page not found' }, { status: 404 });
    return new NextResponse(renderReferencePage({ title: reference.title || 'מקור ייחוס',
        text: chunks.map((chunk) => String(chunk.text || '')).join('\n\n'), page,
        totalPages: reference.page_count || 0, projectId, referenceId,
    }), { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
        'X-Content-Type-Options': 'nosniff',
    } });
}
