import { NextRequest, NextResponse } from "next/server";
import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { archiveContradictionRows, type ContradictionArchiveRow } from "@/utils/contradiction-archive";
import { getDocumentStorageBucket, getDocumentStoragePath } from "@/utils/document-storage";
import { createClient } from "@/utils/supabase/server";

type OwnedDocumentForDelete = {
    id: string;
    project_id: string;
    file_url?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
};

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const documentId = searchParams.get('id');
        const projectId = searchParams.get('projectId');

        if (!projectId) {
            return NextResponse.json({ error: "Project ID is required" }, { status: 400 });
        }

        if (!documentId) {
            return NextResponse.json({ error: "Document ID is required" }, { status: 400 });
        }

        const supabase = await createClient();

        const projectOwnership = await requireOwnedProject(supabase, projectId);
        if (!projectOwnership.ok) {
            return projectOwnership.response;
        }

        const ownership = await requireOwnedDocument<OwnedDocumentForDelete>(
            supabase,
            documentId,
            "id, project_id, file_url, storage_bucket, storage_path"
        );

        if (!ownership.ok) {
            return ownership.response;
        }

        const doc = ownership.document;

        if (doc.project_id !== projectId) {
            return NextResponse.json({ error: "Document does not belong to the requested project" }, { status: 403 });
        }

        const storagePath = getDocumentStoragePath(doc);

        if (storagePath) {
            try {
                const { error: storageError } = await supabase.storage
                    .from(getDocumentStorageBucket(doc))
                    .remove([storagePath]);

                if (storageError) {
                    console.error("Error deleting from storage:", storageError);
                    // Continue to delete from DB even if storage deletion fails
                }
            } catch (e) {
                console.error("Failed to parse storage url for deletion:", e);
            }
        }

        // 3. Invalidate analysis created from this document before deletion.
        const { data: linkedContradictions, error: linkedContradictionsError } = await supabase
            .from('contradictions')
            .select('id, evidence_data')
            .eq('project_id', doc.project_id)
            .neq('status', 'ARCHIVED')
            .or(`source_execution_doc_id.eq.${documentId},target_contract_doc_id.eq.${documentId}`);

        if (linkedContradictionsError) {
            throw linkedContradictionsError;
        }

        await archiveContradictionRows(
            supabase,
            (linkedContradictions || []) as ContradictionArchiveRow[],
            {
                deletion_notice: 'Source document was deleted; finding requires rescan before use.',
                deleted_document_id: documentId,
                deleted_at: new Date().toISOString(),
            }
        );

        await supabase
            .from('document_scan_state')
            .delete()
            .eq('work_doc_id', documentId);

        await supabase
            .from('document_scan_state')
            .delete()
            .contains('contract_doc_ids', [documentId]);

        // 4. Delete from database
        console.log(`[delete] Attempting to delete doc ${documentId} from DB...`);
        const { error: dbError } = await supabase
            .from('documents')
            .delete()
            .eq('id', documentId)
            .eq('project_id', doc.project_id);

        if (dbError) {
            console.error("[delete] Database error:", JSON.stringify(dbError, null, 2));
            return NextResponse.json({ 
                error: "Failed to delete from database",
                details: dbError.message,
                code: dbError.code 
            }, { status: 500 });
        }
        console.log(`[delete] Successfully deleted doc ${documentId}`);

        return NextResponse.json({ success: true });

    } catch (error: unknown) {
        console.error("Delete document error:", error);
        const message = error instanceof Error ? error.message : "Failed to delete document";
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
