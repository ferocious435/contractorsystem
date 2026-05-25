import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MIN_USEFUL_TEXT_LENGTH = 1000;

function sha256(input: Buffer | string) {
    return createHash("sha256").update(input).digest("hex");
}

export async function POST(req: NextRequest) {
    try {
        const { documentId, force = false } = await req.json();

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Получить документ из БД
        const { data: doc, error: docError } = await supabase
            .from("documents")
            .select("id, title, file_url, extracted_text, content_hash, extracted_text_hash")
            .eq("id", documentId)
            .single();

        if (docError || !doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // Если текст уже извлечён — вернуть длину
        if (!force && doc.extracted_text && doc.extracted_text.length >= MIN_USEFUL_TEXT_LENGTH) {
            return NextResponse.json({
                success: true,
                textLength: doc.extracted_text.length,
                alreadyExtracted: true,
            });
        }

        if (!doc.file_url) {
            return NextResponse.json({ error: "No file_url for document" }, { status: 400 });
        }

        // 2. Скачать PDF по URL
        const isPDF = doc.title?.toLowerCase().endsWith(".pdf") || doc.file_url.toLowerCase().includes(".pdf");

        if (!isPDF) {
            // Для не-PDF файлов — пометить как "нет текста"
            await supabase
                .from("documents")
                .update({ extracted_text: `[NON-PDF: ${doc.title}]` })
                .eq("id", documentId);

            return NextResponse.json({
                success: true,
                textLength: 0,
                message: "Not a PDF file, skipping extraction",
            });
        }

        console.log(`[extract-text] Downloading PDF: ${doc.file_url}`);
        const pdfResponse = await fetch(doc.file_url);

        if (!pdfResponse.ok) {
            return NextResponse.json(
                { error: `Failed to download PDF: ${pdfResponse.status}` },
                { status: 500 }
            );
        }

        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
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
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PDFParse } = require("pdf-parse");
        const parser = new PDFParse({ data: pdfBuffer });
        const pdfData = await parser.getText();
        await parser.destroy();
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
            .eq("id", documentId);

        if (updateError) {
            console.error("[extract-text] DB update error:", updateError);
            return NextResponse.json(
                { error: "Failed to save extracted text" },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            textLength: extractedText.length,
            pages: pdfData.total || 0,
            contentHash,
            extractedTextHash,
            preview: extractedText.substring(0, 200),
        });

    } catch (error: any) {
        console.error("[extract-text] Error:", error);
        return NextResponse.json(
            { error: error.message || "Text extraction failed" },
            { status: 500 }
        );
    }
}
