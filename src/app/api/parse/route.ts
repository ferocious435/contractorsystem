import { NextRequest, NextResponse } from "next/server";
import { geminiModel, BOQ_PARSING_PROMPT } from "@/lib/gemini";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();

        // Protective guard: only authenticated users can parse documents
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { fileUrl, mimeType } = body;

        if (!fileUrl) {
            return NextResponse.json({ error: "fileUrl is required" }, { status: 400 });
        }

        // 1. Fetch the file securely from the provided URL (assuming it's a signed URL or public URL from Supabase)
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
            throw new Error("Failed to fetch the file from storage.");
        }

        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
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
        } catch (e) {
            console.error("Failed to parse Gemini JSON output:", responseText);
            throw new Error("Gemini returned invalid JSON structure.");
        }

        return NextResponse.json({ success: true, data: parsedData });

    } catch (error: any) {
        console.error("Error in /api/parse:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
