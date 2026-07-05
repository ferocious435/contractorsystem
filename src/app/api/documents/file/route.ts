import { NextRequest, NextResponse } from "next/server";

import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { downloadDocumentBuffer, getDocumentContentType, getDocumentFileName } from "@/utils/document-storage";
import { createClient } from "@/utils/supabase/server";

type FileDocument = {
    id: string;
    project_id: string;
    title?: string | null;
    file_url?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
};

function asciiFileName(value: string) {
    return value.replace(/["\\]/g, "_").replace(/[^\x20-\x7E]/g, "_").slice(0, 160) || "document";
}

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

        const ownership = await requireOwnedDocument<FileDocument>(
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

        const fileBuffer = await downloadDocumentBuffer(supabase, ownership.document);
        const contentType = getDocumentContentType(ownership.document, fileBuffer);
        const fileName = getDocumentFileName(ownership.document);

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `inline; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
                "Cache-Control": "private, max-age=300",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to open document file";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
