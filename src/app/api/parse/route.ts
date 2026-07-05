import { NextRequest, NextResponse } from "next/server";
import { requireOwnedDocument } from "@/app/api/_utils/auth";
import { geminiModel, BOQ_PARSING_PROMPT } from "@/lib/gemini";
import { downloadDocumentBuffer } from "@/utils/document-storage";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const body = await req.json();
        const { documentId, mimeType } = body;

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        const ownership = await requireOwnedDocument(
            supabase,
            documentId,
            "id, title, file_url, storage_bucket, storage_path"
        );

        if (!ownership.ok) {
            return ownership.response;
        }

        const buffer = await downloadDocumentBuffer(supabase, ownership.document);
        const base64Data = buffer.toString("base64");

        // 2. Prepare the payload for Gemini
        // Using inlineData which works well for PDFs and Images under 20MB
        const promptParams = [
            BOQ_PARSING_PROMPT,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: mimeType || "application/pdf" // default to PDF if not provided
                }
            }
        ];

        // 3. Call Gemini API
        const result = await geminiModel.generateContent(promptParams);
        const responseText = result.response.text();

        // 4. Parse the strict JSON response
        let parsedData = [];
        try {
            parsedData = JSON.parse(responseText);
        } catch {
            console.error("Failed to parse Gemini JSON output:", responseText);
            throw new Error("Gemini returned invalid JSON structure.");
        }

        return NextResponse.json({ success: true, data: parsedData });

    } catch (error: unknown) {
        console.error("Error in /api/parse:", error);
        const message = error instanceof Error ? error.message : "Internal Server Error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
