import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { downloadDocumentBuffer } from "@/utils/document-storage";
import { prepareDocumentAnalysisInput } from "@/utils/document-text-extraction";
import { syncProjectContractBase } from "@/utils/project-contract-base-server";
import { createClient } from "@/utils/supabase/server";
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';

type OwnedDocumentForExtraction = {
    id: string;
    project_id: string | null;
    title?: string | null;
    file_url?: string | null;
    storage_bucket?: string | null;
    storage_path?: string | null;
    extracted_text?: string | null;
    content_hash?: string | null;
    extracted_text_hash?: string | null;
    ocr_status?: string | null;
    parsed_json?: Record<string, unknown> | null;
};

function sha256(input: Buffer | string) {
    return createHash("sha256").update(input).digest("hex");
}

export async function POST(req: NextRequest) {
    try {
        const { projectId, documentId, force = false } = await req.json();

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        const supabase = await createClient();

        const projectOwnership = await requireOwnedProject(supabase, projectId);
        if (!projectOwnership.ok) {
            return projectOwnership.response;
        }

        const ownership = await requireOwnedDocument<OwnedDocumentForExtraction>(
            supabase,
            documentId,
            "id, project_id, title, file_url, storage_bucket, storage_path, extracted_text, content_hash, extracted_text_hash, ocr_status, parsed_json"
        );

        if (!ownership.ok) {
            return ownership.response;
        }

        const doc = ownership.document;

        if (doc.project_id !== projectId) {
            return NextResponse.json({ error: "Document does not belong to the requested project" }, { status: 403 });
        }

        // Если текст уже извлечён — вернуть длину
        if (!force && assessDocumentSourceReadiness(doc).extractionComplete) {
            return NextResponse.json({
                success: true,
                textLength: String(doc.extracted_text || '').length,
                alreadyExtracted: true,
            });
        }

        console.log(`[extract-text] Downloading document from private storage: ${doc.title}`);
        const fileBuffer = await downloadDocumentBuffer(supabase, doc);
        const contentHash = sha256(fileBuffer);

        const prepared = await prepareDocumentAnalysisInput(fileBuffer, doc.title || "document");

        if (prepared.kind === "direct") {
            const { error: updateError } = await supabase
                .from("documents")
                .update({
                    ocr_status: "REQUIRES_REVIEW",
                    content_hash: contentHash,
                    processed_at: new Date().toISOString(),
                })
                .eq("id", documentId)
                .eq("project_id", projectId);

            if (updateError) {
                throw new Error(`Failed to save extraction status: ${updateError.message}`);
            }

            return NextResponse.json({
                success: false,
                skipped: true,
                requiresReview: true,
                textLength: 0,
                contentHash,
                message: "The document does not contain readable text for local extraction",
            });
        }

        const extractedText = prepared.extractedText;
        const extractedTextHash = sha256(extractedText);
        const parsedJson = { ...doc.parsed_json, ...(prepared.readingVerification
            ? { source_reading: prepared.readingVerification } : {}) };
        const readiness = assessDocumentSourceReadiness({ ...doc, extracted_text: extractedText,
            parsed_json: parsedJson, ocr_status: prepared.requiresReview ? 'REQUIRES_REVIEW' : 'COMPLETED' });
        const requiresReview = Boolean(prepared.requiresReview) || !readiness.extractionComplete;

        console.log(`[extract-text] Extracted ${extractedText.length} chars from "${doc.title}"`);

        // 4. Сохранить извлечённый текст в БД
        const { error: updateError } = await supabase
            .from("documents")
            .update({
                extracted_text: extractedText,
                ocr_status: requiresReview ? "REQUIRES_REVIEW" : "COMPLETED",
                content_hash: contentHash,
                extracted_text_hash: extractedTextHash,
                parsed_json: parsedJson,
                processed_at: new Date().toISOString()
            })
            .eq("id", documentId)
                .eq("project_id", projectId);

        if (updateError) {
            console.error("[extract-text] DB update error:", updateError);
            return NextResponse.json(
                { error: "Failed to save extracted text" },
                { status: 500 }
            );
        }

        if (projectId) {
            try {
                await syncProjectContractBase(supabase, projectId);
            } catch (syncError) {
                console.error("[extract-text] Contract base sync error:", syncError);
            }
        }

        return NextResponse.json({
            success: true,
            textLength: extractedText.length,
            extractionSource: prepared.extractionSource,
            contentHash,
            extractedTextHash,
            requiresReview,
            ocrConfidence: prepared.ocrConfidence ?? null,
            sourceReadiness: readiness.status,
            readingVerification: prepared.readingVerification ?? null,
            preview: extractedText.substring(0, 200),
        });

    } catch (error: unknown) {
        console.error("[extract-text] Error:", error);
        const message = error instanceof Error ? error.message : "Text extraction failed";
        return NextResponse.json(
            { error: message },
            { status: 500 }
        );
    }
}
