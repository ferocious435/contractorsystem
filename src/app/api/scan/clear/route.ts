import { NextRequest, NextResponse } from "next/server";
import { requireOwnedProject } from "@/app/api/_utils/auth";
import { archiveContradictionRows, type ContradictionArchiveRow } from "@/utils/contradiction-archive";
import { createClient } from "@/utils/supabase/server";

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get('projectId');

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        const { data: rowsToArchive, error: selectError } = await supabase
            .from('contradictions')
            .select('id, evidence_data')
            .eq('project_id', projectId)
            .neq('status', 'ARCHIVED');

        if (selectError) {
            console.error("Error loading contradictions for archive:", selectError);
            return NextResponse.json({ error: "Failed to clear contradictions" }, { status: 500 });
        }

        const archived = await archiveContradictionRows(
            supabase,
            (rowsToArchive || []) as ContradictionArchiveRow[],
            {
                archive_reason: "Findings were cleared from the active radar view. Historical records are retained.",
                archived_at: new Date().toISOString(),
            }
        );

        return NextResponse.json({ success: true, archived, message: "Contradictions archived successfully" });

    } catch (error: unknown) {
        console.error("Clear contradictions error:", error);
        const message = error instanceof Error ? error.message : "Failed to clear contradictions";
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
