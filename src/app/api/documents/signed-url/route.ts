import { NextRequest, NextResponse } from "next/server";
import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { createDocumentSignedUrl, getDocumentContentType, getDocumentPreviewKind } from "@/utils/document-storage";
import { createClient } from "@/utils/supabase/server";

type SignedUrlDocument = {
    id: string;
    project_id: string;
    title?: string | null;
    file_url?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
};

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get("projectId");
        const documentId = searchParams.get("documentId");

        if (!projectId) {
            return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
        }

        if (!documentId) {
            return NextResponse.json({ success: false, error: "documentId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const projectOwnership = await requireOwnedProject(supabase, projectId);
        if (!projectOwnership.ok) {
            return projectOwnership.response;
        }

        const ownership = await requireOwnedDocument<SignedUrlDocument>(
            supabase,
            documentId,
            "id, project_id, title, file_url, storage_bucket, storage_path"
        );

        if (!ownership.ok) {
            return ownership.response;
        }

        if (ownership.document.project_id !== projectId) {
            return NextResponse.json({ success: false, error: "Document does not belong to the requested project" }, { status: 403 });
        }

        const signedUrl = await createDocumentSignedUrl(supabase, ownership.document);
        const contentType = getDocumentContentType(ownership.document);
        const previewKind = getDocumentPreviewKind(ownership.document, contentType);
        const canPreviewInline = ["pdf", "image", "text"].includes(previewKind);
        const inlineUrl = `/api/documents/file?${new URLSearchParams({ projectId, documentId }).toString()}`;

        return NextResponse.json({
            success: true,
            signedUrl,
            inlineUrl,
            title: ownership.document.title || null,
            contentType,
            previewKind,
            canPreviewInline,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to create signed URL";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
