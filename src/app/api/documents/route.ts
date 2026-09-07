import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";

import { requireOwnedProject } from "@/app/api/_utils/auth";
import { DOCUMENTS_BUCKET } from "@/utils/document-storage";
import { getFileExtension } from "@/utils/document-text-extraction";
import { createClient } from "@/utils/supabase/server";

const ALLOWED_CATEGORIES = new Set(["CONTRACT", "EXECUTION", "PRICELIST"]);

function normalizeCategory(value: FormDataEntryValue | string | null) {
    const category = typeof value === "string" ? value : "";
    return ALLOWED_CATEGORIES.has(category) ? category : "EXECUTION";
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "text/tab-separated-values": ".tsv",
};

function getSafeExtension(fileName: string, contentType: string) {
    const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() || "";
    return CONTENT_TYPE_EXTENSIONS[normalizedContentType] || getFileExtension(fileName);
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get("projectId");
        const category = searchParams.get("category");

        if (!projectId) {
            return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        let query = supabase
            .from("documents")
            .select("*")
            .eq("project_id", projectId)
            .order("created_at", { ascending: false });

        if (category && ALLOWED_CATEGORIES.has(category)) {
            query = query.eq("category", category);
        }

        const { data, error } = await query;
        if (error) throw error;

        return NextResponse.json({ success: true, documents: data || [] });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch documents";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const projectId = formData.get("projectId");
        const file = formData.get("file");

        if (typeof projectId !== "string" || !projectId.trim()) {
            return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
        }

        if (!(file instanceof File)) {
            return NextResponse.json({ success: false, error: "file is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
        const storagePath = `${projectId}/${randomUUID()}${getSafeExtension(file.name, file.type || "")}`;

        const { error: storageError } = await supabase.storage
            .from(DOCUMENTS_BUCKET)
            .upload(storagePath, fileBuffer, {
                contentType: file.type || "application/octet-stream",
                upsert: false,
            });

        if (storageError) throw storageError;

        const { data: document, error: insertError } = await supabase
            .from("documents")
            .insert({
                project_id: projectId,
                title: file.name,
                category: normalizeCategory(formData.get("category")),
                file_url: null,
                storage_bucket: DOCUMENTS_BUCKET,
                storage_path: storagePath,
                content_hash: contentHash,
                ai_status: "PENDING",
            })
            .select()
            .single();

        if (insertError) {
            await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
            throw insertError;
        }

        return NextResponse.json({ success: true, document });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to upload document";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
