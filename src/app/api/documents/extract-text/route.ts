import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
    try {
        const { documentId } = await req.json();

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        const supabase = createClient(supabaseUrl, supabaseKey);

        // 1. Получить документ из БД
        const { data: doc, error: docError } = await supabase
            .from("documents")
            .select("id, title, file_url, extracted_text")
            .eq("id", documentId)
            .single();

        if (docError || !doc) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        // Если текст уже извлечён — вернуть длину
        if (doc.extracted_text && doc.extracted_text.length > 0) {
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

        // 3. Извлечь текст через pdf-parse
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require("pdf-parse");
        const pdfData = await pdfParse(pdfBuffer);
        const extractedText = pdfData.text || "";

        console.log(`[extract-text] Extracted ${extractedText.length} chars from "${doc.title}"`);

        // 4. Сохранить извлечённый текст в БД
        const { error: updateError } = await supabase
            .from("documents")
            .update({ extracted_text: extractedText })
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
            pages: pdfData.numpages || 0,
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
