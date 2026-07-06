import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";

import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { DOCUMENTS_BUCKET, downloadDocumentBuffer } from "@/utils/document-storage";
import {
    parseReferencePdf,
    type ReferenceDocumentChunk,
    type ReferenceDocumentType,
} from "@/utils/reference-library-parser";
import { createClient } from "@/utils/supabase/server";

export const maxDuration = 300;

const REFERENCE_CHUNK_BATCH_SIZE = 200;

type SourceDocumentRecord = {
    id: string;
    project_id?: string | null;
    title?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
};

function normalizeReferenceType(value: unknown, fileName = ""): ReferenceDocumentType {
    const raw = String(value || "").trim().toUpperCase();
    if (["BLUE_BOOK", "SHELF_CONTRACT_3210", "ISRAELI_STANDARD", "OTHER_REFERENCE"].includes(raw)) {
        return raw as ReferenceDocumentType;
    }

    const title = fileName.toLowerCase();
    if (title.includes("3210") || fileName.includes("חוזה מדף") || fileName.includes("מדף")) {
        return "SHELF_CONTRACT_3210";
    }

    if (
        title.includes("blue") ||
        title.includes("specifications_") ||
        fileName.includes("ספר כחול") ||
        fileName.includes("הספר הכחול") ||
        fileName.includes("מפרט כללי")
    ) {
        return "BLUE_BOOK";
    }

    return "OTHER_REFERENCE";
}

function getAuthorityScope(referenceType: ReferenceDocumentType) {
    return referenceType === "ISRAELI_STANDARD" ? "GLOBAL_STANDARD" : "REFERENCE_ONLY";
}

function getPublisher(referenceType: ReferenceDocumentType) {
    if (referenceType === "BLUE_BOOK" || referenceType === "SHELF_CONTRACT_3210") {
        return "מדינת ישראל";
    }

    return null;
}

function getDefaultTitle(referenceType: ReferenceDocumentType, fileName: string) {
    if (referenceType === "BLUE_BOOK") return "המפרט הכללי / הספר הכחול";
    if (referenceType === "SHELF_CONTRACT_3210") return "חוזה מדף 3210";
    return fileName || "מסמך ייחוס";
}

async function insertChunksInBatches(
    supabase: Awaited<ReturnType<typeof createClient>>,
    referenceDocumentId: string,
    chunks: ReferenceDocumentChunk[],
) {
    for (let i = 0; i < chunks.length; i += REFERENCE_CHUNK_BATCH_SIZE) {
        const batch = chunks.slice(i, i + REFERENCE_CHUNK_BATCH_SIZE).map((chunk) => ({
            reference_document_id: referenceDocumentId,
            ...chunk,
        }));

        const { error } = await supabase
            .from("reference_document_chunks")
            .insert(batch);

        if (error) {
            throw error;
        }
    }
}

export async function POST(req: NextRequest) {
    const supabase = await createClient();
    let referenceDocumentId: string | null = null;
    let ingestJobId: string | null = null;

    try {
        const formData = await req.formData();
        const projectId = String(formData.get("projectId") || "").trim();
        const sourceDocumentId = String(formData.get("sourceDocumentId") || "").trim();
        const localSourcePath = String(formData.get("localSourcePath") || "").trim();
        const file = formData.get("file");

        if (!projectId) {
            return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 });
        }

        const ownership = await requireOwnedProject(supabase, projectId);
        if (!ownership.ok) {
            return ownership.response;
        }

        let fileBuffer: Buffer;
        let sourceFileName: string;
        let storageBucket: string | null = null;
        let storagePath: string | null = null;
        let linkedSourceDocumentId: string | null = null;

        if (file instanceof File) {
            sourceFileName = file.name;
            fileBuffer = Buffer.from(await file.arrayBuffer());
        } else if (sourceDocumentId) {
            const documentOwnership = await requireOwnedDocument<SourceDocumentRecord>(
                supabase,
                sourceDocumentId,
                "id, project_id, title, storage_bucket, storage_path, file_url",
            );

            if (!documentOwnership.ok) {
                return documentOwnership.response;
            }

            const sourceDocument = documentOwnership.document;
            if (sourceDocument.project_id !== projectId) {
                return NextResponse.json({ success: false, error: "Source document does not belong to project" }, { status: 403 });
            }

            sourceFileName = sourceDocument.title || sourceDocument.id;
            fileBuffer = await downloadDocumentBuffer(supabase, sourceDocument);
            storageBucket = sourceDocument.storage_bucket || DOCUMENTS_BUCKET;
            storagePath = sourceDocument.storage_path || null;
            linkedSourceDocumentId = sourceDocument.id;
        } else {
            return NextResponse.json({ success: false, error: "file or sourceDocumentId is required" }, { status: 400 });
        }

        const referenceType = normalizeReferenceType(formData.get("referenceType"), sourceFileName);
        const contentHash = createHash("sha256").update(fileBuffer).digest("hex");
        const jobSignature = `${projectId}:${referenceType}:${contentHash}`;

        const { data: existingReference, error: existingError } = await supabase
            .from("reference_documents")
            .select("id, title, status, page_count, content_hash")
            .eq("contractor_id", ownership.user.id)
            .eq("project_id", projectId)
            .eq("reference_type", referenceType)
            .eq("content_hash", contentHash)
            .maybeSingle();

        if (existingError) {
            throw existingError;
        }

        if (existingReference?.id && existingReference.status === "READY") {
            return NextResponse.json({
                success: true,
                reused: true,
                referenceDocument: existingReference,
            });
        }

        if (file instanceof File) {
            storageBucket = DOCUMENTS_BUCKET;
            storagePath = `reference-library/${projectId}/${randomUUID()}.pdf`;
            const { error: storageError } = await supabase.storage
                .from(storageBucket)
                .upload(storagePath, fileBuffer, {
                    contentType: file.type || "application/pdf",
                    upsert: false,
                });

            if (storageError) {
                throw storageError;
            }
        }

        const { data: referenceDocument, error: referenceError } = await supabase
            .from("reference_documents")
            .insert({
                contractor_id: ownership.user.id,
                project_id: projectId,
                source_document_id: linkedSourceDocumentId,
                reference_type: referenceType,
                authority_scope: getAuthorityScope(referenceType),
                title: getDefaultTitle(referenceType, sourceFileName),
                publisher: getPublisher(referenceType),
                source_file_name: sourceFileName,
                storage_bucket: storageBucket,
                storage_path: storagePath,
                local_source_path: localSourcePath || null,
                content_hash: contentHash,
                status: "PROCESSING",
                metadata: {
                    source: linkedSourceDocumentId ? "documents" : "upload",
                },
            })
            .select("id")
            .single();

        if (referenceError) {
            throw referenceError;
        }

        const insertedReferenceDocumentId = referenceDocument.id as string;
        referenceDocumentId = insertedReferenceDocumentId;

        const { data: ingestJob, error: jobError } = await supabase
            .from("reference_ingest_jobs")
            .upsert({
                contractor_id: ownership.user.id,
                project_id: projectId,
                reference_document_id: insertedReferenceDocumentId,
                job_signature: jobSignature,
                source_kind: "PDF",
                status: "IN_PROGRESS",
                current_step: "extracting_pdf_text",
                started_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                metadata: { source_file_name: sourceFileName, reference_type: referenceType },
            }, { onConflict: "job_signature" })
            .select("id")
            .single();

        if (jobError) {
            throw jobError;
        }

        ingestJobId = ingestJob.id;

        const parsed = await parseReferencePdf(fileBuffer, referenceType);

        await supabase
            .from("reference_ingest_jobs")
            .update({
                total_units: parsed.chunks.length,
                processed_units: 0,
                current_step: "saving_chunks",
                resume_cursor: { chunk_offset: 0 },
                updated_at: new Date().toISOString(),
            })
            .eq("id", ingestJobId);

        await insertChunksInBatches(supabase, insertedReferenceDocumentId, parsed.chunks);

        await supabase
            .from("reference_documents")
            .update({
                text_hash: parsed.text_hash,
                page_count: parsed.page_count,
                status: "READY",
                updated_at: new Date().toISOString(),
                metadata: {
                    chunk_count: parsed.chunks.length,
                    parser: "reference-parser-v1",
                },
            })
            .eq("id", insertedReferenceDocumentId);

        await supabase
            .from("reference_ingest_jobs")
            .update({
                status: "COMPLETED",
                processed_units: parsed.chunks.length,
                current_step: "completed",
                resume_cursor: { chunk_offset: parsed.chunks.length },
                updated_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
            })
            .eq("id", ingestJobId);

        return NextResponse.json({
            success: true,
            referenceDocumentId: insertedReferenceDocumentId,
            referenceType,
            pageCount: parsed.page_count,
            chunkCount: parsed.chunks.length,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to ingest reference document";

        if (referenceDocumentId) {
            await supabase
                .from("reference_documents")
                .update({ status: "ERROR", updated_at: new Date().toISOString(), metadata: { error: message } })
                .eq("id", referenceDocumentId);
        }

        if (ingestJobId) {
            await supabase
                .from("reference_ingest_jobs")
                .update({
                    status: "ERROR",
                    error_message: message,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", ingestJobId);
        }

        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}
