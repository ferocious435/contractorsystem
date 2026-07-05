import { NextResponse } from 'next/server';
import { requireOwnedDocument, requireOwnedProject } from '@/app/api/_utils/auth';
import { createClient } from '@/utils/supabase/server';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function PUT(req: Request) {
    try {
        const supabase = await createClient();

        // Ensure user is authenticated
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId, documentId, validatedData } = await req.json();

        if (!projectId || !documentId || !validatedData) {
            return NextResponse.json({ error: "projectId, documentId and validatedData are required" }, { status: 400 });
        }

        const projectOwnership = await requireOwnedProject(supabase, projectId);
        if (!projectOwnership.ok) {
            return projectOwnership.response;
        }

        const ownership = await requireOwnedDocument<{ id: string; project_id: string; ai_status?: string | null }>(supabase, documentId, 'id, project_id, ai_status');

        if (!ownership.ok) {
            return ownership.response;
        }

        if (ownership.document.project_id !== projectId) {
            return NextResponse.json({ error: "Document does not belong to the requested project" }, { status: 403 });
        }

        if (ownership.document.ai_status === 'ERROR' || ownership.document.ai_status === 'PROCESSING' || ownership.document.ai_status === 'EXTRACTING') {
            return NextResponse.json({ error: "Document is not ready for validation" }, { status: 409 });
        }

        if (!isRecord(validatedData)) {
            return NextResponse.json({ error: "validatedData must be an object" }, { status: 400 });
        }

        if (validatedData.system_error || validatedData.analysis_status === 'AI_ERROR') {
            return NextResponse.json({ error: "Cannot validate a failed AI analysis" }, { status: 409 });
        }

        const hasDocumentType = typeof validatedData.type === 'string' || typeof validatedData.document_type === 'string';
        const hasSummary = typeof validatedData.summary === 'string' && validatedData.summary.trim().length > 0;
        if (!hasDocumentType && !hasSummary) {
            return NextResponse.json({ error: "Document has no clear analysis to validate" }, { status: 400 });
        }

        // Update status to VALIDATED and save the confirmed JSON
        const { error: updateError } = await supabase
            .from('documents')
            .update({
                ai_status: 'VALIDATED',
                parsed_json: validatedData
            })
            .eq('id', documentId)
            .eq('project_id', projectId);

        if (updateError) throw updateError;

        return NextResponse.json({
            success: true,
            message: "Document validated successfully"
        });

    } catch (error: unknown) {
        console.error("Error validating document:", error);
        const message = error instanceof Error ? error.message : "Document validation failed";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
