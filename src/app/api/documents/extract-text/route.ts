import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireOwnedDocument, requireOwnedProject } from "@/app/api/_utils/auth";
import { downloadDocumentBuffer, isPdfDocument } from "@/utils/document-storage";
import { extractPdfText } from "@/utils/document-text-extraction";
import { syncProjectContractBase } from "@/utils/project-contract-base-server";
import { createClient } from "@/utils/supabase/server";

const MIN_USEFUL_TEXT_LENGTH = 1000;

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
            "id, project_id, title, file_url, storage_bucket, storage_path, extracted_text, content_hash, extracted_text_hash"
        );

        if (!ownership.ok) {
            return ownership.response;
        }

        const doc = ownership.document;

        if (doc.project_id !== projectId) {
            return NextResponse.json({ error: "Document does not belong to the requested project" }, { status: 403 });
        }

        // Если текст уже извлечён — вернуть длину
        if (!force && doc.extracted_text && doc.extracted_text.length >= MIN_USEFUL_TEXT_LENGTH) {
            return NextResponse.json({
                success: true,
                textLength: doc.extracted_text.length,
                alreadyExtracted: true,
            });
        }

        if (!isPdfDocument(doc)) {
            // Для не-PDF файлов — пометить как "нет текста"
            return NextResponse.json({
                success: true,
                skipped: true,
                textLength: typeof doc.extracted_text === "string" ? doc.extracted_text.length : 0,
                message: "Not a PDF file, skipping PDF extraction",
            });
        }

        console.log(`[extract-text] Downloading PDF from private storage: ${doc.title}`);
        const pdfBuffer = await downloadDocumentBuffer(supabase, doc);
        const contentHash = sha256(pdfBuffer);

        if (
            !force &&
            doc.content_hash === contentHash &&
            doc.extracted_text &&
            doc.extracted_text.length >= MIN_USEFUL_TEXT_LENGTH
        ) {
            return NextResponse.json({
                success: true,
                textLength: doc.extracted_text.length,
                alreadyExtracted: true,
                contentHash
            });
        }

        // 3. Извлечь текст через pdf-parse
        const pdfData = await extractPdfText(pdfBuffer);
        const extractedText = pdfData.text || "";
        const extractedTextHash = sha256(extractedText);

        console.log(`[extract-text] Extracted ${extractedText.length} chars from "${doc.title}"`);

        // 4. Сохранить извлечённый текст в БД
        const { error: updateError } = await supabase
            .from("documents")
            .update({
                extracted_text: extractedText,
                ocr_status: extractedText.length >= MIN_USEFUL_TEXT_LENGTH ? "COMPLETED" : "REQUIRES_REVIEW",
                content_hash: contentHash,
                extracted_text_hash: extractedTextHash,
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
            pages: pdfData.pages || 0,
            contentHash,
            extractedTextHash,
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
