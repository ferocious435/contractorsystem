import { NextResponse } from 'next/server';
import { requireOwnedDocument, requireOwnedProject } from '@/app/api/_utils/auth';
import { createClient } from '@/utils/supabase/server';
import { downloadDocumentBuffer } from '@/utils/document-storage';
import { DOCUMENT_ANALYSIS_PROMPT, geminiModel, requireGeminiApiKey, withRetry } from '@/lib/gemini';
import type { PreparedDocumentAnalysisInput } from '@/utils/document-text-extraction';
import {
    getFileExtension,
    getReadableFormatSummary,
    getSupportedGeminiMimeType,
    prepareDocumentAnalysisInput,
} from '@/utils/document-text-extraction';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseGeminiJsonObject(responseText: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(responseText);
        if (!isRecord(parsed)) {
            throw new Error('Gemini response did not contain a JSON object');
        }
        return parsed;
    } catch {
        const start = responseText.indexOf('{');
        const end = responseText.lastIndexOf('}');

        if (start === -1 || end === -1 || end <= start) {
            throw new Error('Gemini response did not contain a JSON object');
        }

        const parsed: unknown = JSON.parse(responseText.slice(start, end + 1));
        if (!isRecord(parsed)) {
            throw new Error('Gemini response did not contain a JSON object');
        }
        return parsed;
    }
}


function getAiErrorCode(error: unknown, docTitle: string) {
    const message = error instanceof Error ? error.message : String(error || "");

    if (/GOOGLE_NATIVE_EXPORT_REQUIRED/i.test(message)) return "GOOGLE_NATIVE_EXPORT_REQUIRED";
    if (/CAD_CONVERTER_REQUIRED/i.test(message)) return "CAD_CONVERTER_REQUIRED";
    if (/BIM_CONVERTER_REQUIRED/i.test(message)) return "BIM_CONVERTER_REQUIRED";
    if (/PROJECT_FILE_CONVERTER_REQUIRED/i.test(message)) return "PROJECT_FILE_CONVERTER_REQUIRED";
    if (/BOQ_CONVERTER_REQUIRED/i.test(message)) return "BOQ_CONVERTER_REQUIRED";
    if (/LEGACY_SPREADSHEET_CONVERSION_REQUIRED/i.test(message)) return "LEGACY_SPREADSHEET_CONVERSION_REQUIRED";
    if (/LEGACY_PRESENTATION_CONVERSION_REQUIRED/i.test(message)) return "LEGACY_PRESENTATION_CONVERSION_REQUIRED";
    if (/DOCUMENT_TEXT_EXTRACTION_EMPTY/i.test(message)) return "DOCUMENT_TEXT_EXTRACTION_EMPTY";
    if (/UNSUPPORTED_DOCUMENT_TYPE/i.test(message)) return "UNSUPPORTED_DOCUMENT_TYPE";
    if (/officeparser|word-extractor|parseOffice|extract/i.test(message) && !getSupportedGeminiMimeType(docTitle)) {
        return "DOCUMENT_TEXT_EXTRACTION_FAILED";
    }
    if (/GEMINI_API_KEY is missing/i.test(message)) return "GEMINI_API_KEY_MISSING";
    if (/reported as leaked/i.test(message)) return "GEMINI_KEY_REPORTED_LEAKED";
    if (/429|Too Many Requests|quota|rate limit|rate-limit|RESOURCE_EXHAUSTED/i.test(message)) {
        return "AI_RATE_LIMIT";
    }
    if (/document has no pages/i.test(message)) return "DOCUMENT_HAS_NO_PAGES";
    if (/JSON|Expected ','|Expected '}'|did not contain a JSON object/i.test(message)) {
        return "AI_INVALID_JSON";
    }

    return "AI_ANALYSIS_FAILED";
}

function getAiErrorStatus(code: string) {
    if (code === "AI_RATE_LIMIT") return 429;
    if (
        code === "UNSUPPORTED_DOCUMENT_TYPE"
        || code === "DOCUMENT_HAS_NO_PAGES"
        || code === "GOOGLE_NATIVE_EXPORT_REQUIRED"
        || code === "CAD_CONVERTER_REQUIRED"
        || code === "BIM_CONVERTER_REQUIRED"
        || code === "PROJECT_FILE_CONVERTER_REQUIRED"
        || code === "BOQ_CONVERTER_REQUIRED"
        || code === "LEGACY_SPREADSHEET_CONVERSION_REQUIRED"
        || code === "LEGACY_PRESENTATION_CONVERSION_REQUIRED"
        || code === "DOCUMENT_TEXT_EXTRACTION_EMPTY"
        || code === "DOCUMENT_TEXT_EXTRACTION_FAILED"
    ) return 415;
    if (code === "GEMINI_API_KEY_MISSING" || code === "GEMINI_KEY_REPORTED_LEAKED") return 503;
    return 502;
}

function getAiErrorUserMessage(code: string) {
    const messages: Record<string, string> = {
        AI_RATE_LIMIT: "AI rate limit was reached. Wait a short time and try again.",
        UNSUPPORTED_DOCUMENT_TYPE: `This file type is not supported yet. Supported now: ${getReadableFormatSummary()}.`,
        GOOGLE_NATIVE_EXPORT_REQUIRED: "Google native files contain only a Drive pointer. Export them as DOCX, XLSX, PPTX, PDF, ODT, ODS, or ODP first.",
        CAD_CONVERTER_REQUIRED: "This CAD drawing needs a CAD converter or export to PDF/DXF before analysis.",
        BIM_CONVERTER_REQUIRED: "This BIM/model file needs a BIM converter or export to PDF/IFC before analysis.",
        PROJECT_FILE_CONVERTER_REQUIRED: "This schedule/project file needs export to PDF, XML, CSV, or XLSX before analysis.",
        BOQ_CONVERTER_REQUIRED: "This quantity/BOQ file looks proprietary or binary. Export it to XLSX, CSV, XML, PDF, or a text TLV/SKN first.",
        LEGACY_SPREADSHEET_CONVERSION_REQUIRED: "Legacy XLS needs export to XLSX, CSV, XML, or PDF before analysis.",
        LEGACY_PRESENTATION_CONVERSION_REQUIRED: "Legacy PPT needs export to PPTX or PDF before analysis.",
        DOCUMENT_TEXT_EXTRACTION_EMPTY: "The document opened, but no readable text was found.",
        DOCUMENT_TEXT_EXTRACTION_FAILED: "The document text could not be extracted. Try exporting it to PDF or a newer Office format.",
        DOCUMENT_HAS_NO_PAGES: "The file was sent as a document, but the AI provider could not read any pages.",
        AI_INVALID_JSON: "The AI returned an unreadable structured answer. Try again later.",
        GEMINI_API_KEY_MISSING: "AI key is missing on the server.",
        GEMINI_KEY_REPORTED_LEAKED: "AI key was rejected by the provider.",
        AI_ANALYSIS_FAILED: "AI document analysis failed. The document was not fully processed.",
    };

    return messages[code] || messages.AI_ANALYSIS_FAILED;
}

const TEXT_FALLBACK_AI_ERROR_CODES = new Set([
    "AI_RATE_LIMIT",
    "AI_INVALID_JSON",
    "AI_ANALYSIS_FAILED",
    "GEMINI_API_KEY_MISSING",
    "GEMINI_KEY_REPORTED_LEAKED",
]);

function canUseTextFallbackAfterAiError(
    code: string,
    analysisInput: PreparedDocumentAnalysisInput | null
): analysisInput is Extract<PreparedDocumentAnalysisInput, { kind: "text" }> {
    return (
        TEXT_FALLBACK_AI_ERROR_CODES.has(code)
        && analysisInput?.kind === "text"
        && analysisInput.extractedText.trim().length > 0
    );
}

function buildTextFallbackParsedData(
    docTitle: string,
    docCategory: string,
    analysisInput: Extract<PreparedDocumentAnalysisInput, { kind: "text" }>,
    aiErrorCode: string,
    aiErrorMessage: string
) {
    const parsedData = classifyByTitle(docTitle, docCategory);
    const warningMessage = getAiErrorUserMessage(aiErrorCode);

    parsedData.analysis_status = "TEXT_EXTRACTED_AI_PENDING";
    parsedData.analysis_source = "text_extraction_fallback";
    parsedData.extraction_source = analysisInput.extractionSource;
    parsedData.file_extension = getFileExtension(docTitle) || null;
    parsedData.confidence = 0.2;
    parsedData.full_markdown = analysisInput.extractedText;
    parsedData.ai_degraded = true;
    parsedData.warnings = [
        {
            code: aiErrorCode,
            message: warningMessage,
            technical_message: aiErrorMessage,
        },
    ];

    return parsedData;
}
/**
 * POST /api/documents/process
 * 
 * ׳§׳•׳¨׳ ׳׳× ׳”׳׳¡׳׳ ׳‘׳׳׳¦׳¢׳•׳× Gemini AI ׳•׳׳—׳׳¥ ׳׳™׳“׳¢ ׳׳•׳‘׳ ׳”.
 * ׳¢׳•׳‘׳“ ׳¢׳ ׳›׳ ׳¡׳•׳’׳™ ׳”׳׳¡׳׳›׳™׳: ׳—׳•׳–׳™׳, ׳›׳×׳‘׳™ ׳›׳׳•׳™׳•׳×, ׳₪׳¨׳•׳˜׳•׳§׳•׳׳™׳, ׳׳›׳×׳‘׳™׳ ׳•׳›׳•'.
 */
export async function POST(req: Request) {
    let documentIdForStatus: string | null = null;
    let projectIdForStatus: string | null = null;

    try {
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { projectId, documentId } = await req.json();
        documentIdForStatus = typeof documentId === "string" ? documentId : null;
        projectIdForStatus = typeof projectId === "string" ? projectId : null;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        if (!documentId) {
            return NextResponse.json({ error: "documentId is required" }, { status: 400 });
        }

        // 1. ׀׀¾׀»ׁƒׁ‡׀°׀µ׀¼ ׀´׀¾׀÷ׁƒ׀¼׀µ׀½ׁ‚ ׀¸׀· ׀‘׀”
        const projectOwnership = await requireOwnedProject(supabase, projectId);
        if (!projectOwnership.ok) {
            return projectOwnership.response;
        }

        const ownership = await requireOwnedDocument<Record<string, unknown>>(supabase, documentId, '*');

        if (!ownership.ok) {
            return ownership.response;
        }

        const doc = ownership.document;
        const docProjectId = typeof doc.project_id === "string" ? doc.project_id : "";
        if (docProjectId !== projectId) {
            return NextResponse.json({ error: "Document does not belong to the requested project" }, { status: 403 });
        }
        const docTitle = typeof doc.title === 'string' ? doc.title : '';
        const docCategory = typeof doc.category === 'string' ? doc.category : '';

        // 2. ׀׀±׀½׀¾׀²׀»ׁ׀µ׀¼ ׁׁ‚׀°ׁ‚ׁƒׁ ׀½׀° PROCESSING
        await supabase
            .from('documents')
            .update({ ai_status: 'PROCESSING' })
            .eq('id', documentId)
            .eq('project_id', projectId);

        // 3. ׀׀½׀°׀»׀¸׀·׀¸ׁ€ׁƒ׀µ׀¼ ׀´׀¾׀÷ׁƒ׀¼׀µ׀½ׁ‚ ׁ‡׀µׁ€׀µ׀· Gemini AI
        let parsedData: Record<string, unknown>;
        let analysisInput: PreparedDocumentAnalysisInput | null = null;

        try {
            const fileBuffer = await downloadDocumentBuffer(supabase, doc);
            analysisInput = await prepareDocumentAnalysisInput(fileBuffer, docTitle);
            requireGeminiApiKey();
            const model = geminiModel;

            console.log(`[process] Deep analysis for "${docTitle}" with Gemini 3.5 Flash (${analysisInput.extractionSource})`);

            const contentParts: Array<string | { inlineData: { mimeType: string; data: string } }> = analysisInput.kind === "direct"
                ? [
                    DOCUMENT_ANALYSIS_PROMPT,
                    `Document title: "${docTitle}"\nCategory: ${docCategory}`,
                    {
                        inlineData: {
                            mimeType: analysisInput.mimeType,
                            data: analysisInput.fileBuffer.toString('base64'),
                        }
                    }
                ]
                : [
                    DOCUMENT_ANALYSIS_PROMPT,
                    `Document title: "${docTitle}"\nCategory: ${docCategory}\nFile extension: ${getFileExtension(docTitle) || "unknown"}\nText extraction source: ${analysisInput.extractionSource}${analysisInput.wasTruncated ? "\nNote: extracted text was truncated before AI analysis." : ""}`,
                    `Extracted document text:\n\n${analysisInput.aiText}`,
                ];

            const result = await withRetry(() => model.generateContent(contentParts));
            const responseText = result.response.text();
            parsedData = parseGeminiJsonObject(responseText);
            parsedData.extraction_source = analysisInput.extractionSource;
            parsedData.file_extension = getFileExtension(docTitle) || null;

            if (analysisInput.kind === "text" && typeof parsedData.full_markdown !== "string") {
                parsedData.full_markdown = analysisInput.extractedText;
            }

            // Save extracted markdown/text for later evidence workflows.
            const fullMarkdown = typeof parsedData.full_markdown === 'string'
                ? parsedData.full_markdown
                : analysisInput.extractedText;
            if (fullMarkdown) {
                await supabase
                    .from('documents')
                    .update({
                        extracted_text: fullMarkdown,
                        ocr_status: 'COMPLETED'
                    })
                    .eq('id', documentId)
                    .eq('project_id', projectId);
                console.log(`[process] Digital Twin created (${fullMarkdown.length} chars)`);
            }

        } catch (aiError: unknown) {
            console.error("[process] Gemini AI error:", aiError);
            const aiErrorMessage = aiError instanceof Error ? aiError.message : 'Unknown AI processing error';
            const aiErrorCode = getAiErrorCode(aiError, docTitle);

            if (canUseTextFallbackAfterAiError(aiErrorCode, analysisInput)) {
                parsedData = buildTextFallbackParsedData(docTitle, docCategory, analysisInput, aiErrorCode, aiErrorMessage);

                const { error: aiUpdateError } = await supabase
                    .from('documents')
                    .update({
                        ai_status: 'SCANNED',
                        parsed_json: parsedData,
                        extracted_text: analysisInput.extractedText,
                        ocr_status: 'COMPLETED'
                    })
                    .eq('id', documentId)
                    .eq('project_id', projectId);

                if (aiUpdateError) throw aiUpdateError;

                return NextResponse.json({
                    success: true,
                    ai_status: 'SCANNED',
                    ai_degraded: true,
                    warning: getAiErrorUserMessage(aiErrorCode),
                    parsed_json: parsedData
                });
            }

            parsedData = classifyByTitle(docTitle, docCategory);
            parsedData.analysis_status = 'AI_ERROR';
            parsedData.analysis_source = 'filename_fallback';
            parsedData.system_error = aiErrorCode;
            parsedData.system_errors = [
                {
                    code: aiErrorCode,
                    message: getAiErrorUserMessage(aiErrorCode),
                    technical_message: aiErrorMessage,
                },
            ];

            const { error: aiUpdateError } = await supabase
                .from('documents')
                .update({
                    ai_status: 'ERROR',
                    parsed_json: parsedData
                })
                .eq('id', documentId)
                .eq('project_id', projectId);

            if (aiUpdateError) throw aiUpdateError;

            return NextResponse.json({
                success: false,
                ai_status: 'ERROR',
                error: getAiErrorUserMessage(aiErrorCode),
                parsed_json: parsedData
            }, { status: getAiErrorStatus(aiErrorCode) });
        }

        // 4. ׀¡׀¾ׁ…ׁ€׀°׀½ׁ׀µ׀¼ ׁ€׀µ׀·ׁƒ׀»ׁׁ‚׀°ׁ‚
        const { error: updateError } = await supabase
            .from('documents')
            .update({
                ai_status: 'SCANNED',
                parsed_json: parsedData
            })
            .eq('id', documentId)
            .eq('project_id', projectId);

        if (updateError) throw updateError;

        return NextResponse.json({
            success: true,
            autoValidated: false,
            message: `׳”׳׳¡׳׳ "${parsedData.type}" ׳ ׳¡׳¨׳§. ׳ ׳“׳¨׳© ׳׳™׳׳•׳× ׳ ׳×׳•׳ ׳™׳ ׳׳₪׳ ׳™ ׳§׳׳™׳˜׳” ׳¡׳•׳₪׳™׳×.`,
            parsed_json: parsedData
        });

    } catch (error: unknown) {
        console.error("Error processing document:", error);

        // ׀׀±׀½׀¾׀²׀»ׁ׀µ׀¼ ׁׁ‚׀°ׁ‚ׁƒׁ ׀½׀° ERROR
        try {
            if (documentIdForStatus && projectIdForStatus) {
                const supabase = await createClient();
                const ownership = await requireOwnedDocument<{ id: string; project_id: string }>(supabase, documentIdForStatus, 'id, project_id');

                if (ownership.ok && ownership.document.project_id === projectIdForStatus) {
                    await supabase
                        .from('documents')
                        .update({ ai_status: 'ERROR' })
                        .eq('id', documentIdForStatus)
                        .eq('project_id', projectIdForStatus);
                }
            }
        } catch { /* ignore cleanup errors */ }

        const message = error instanceof Error ? error.message : "Error processing document";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

function classifyByTitle(title: string, category: string): Record<string, unknown> {
    const lower = title.toLowerCase();

    if (lower.includes('כמות') || lower.includes('כמויות') || lower.includes('boq') || lower.includes('tlv') || lower.includes('skn')) {
        return { type: 'כתב כמויות', category: 'CONTRACT', summary: 'כתב כמויות - סיווג לפי שם הקובץ' };
    }
    if (lower.includes('הסכם') || lower.includes('חוזה')) {
        return { type: 'הסכם', category: 'CONTRACT', summary: 'הסכם - סיווג לפי שם הקובץ' };
    }
    if (lower.includes('מפרט')) {
        return { type: 'מפרט טכני', category: 'CONTRACT', summary: 'מפרט טכני - סיווג לפי שם הקובץ' };
    }
    if (lower.includes('פרוטוקול') || lower.includes('סיכום ישיבה')) {
        return { type: 'פרוטוקול ישיבה', category: 'EXECUTION', summary: 'פרוטוקול ישיבה - סיווג לפי שם הקובץ' };
    }
    if (lower.includes('מחירון') || lower.includes('דקל')) {
        return { type: 'מחירון', category: 'PRICELIST', summary: 'מחירון - סיווג לפי שם הקובץ' };
    }

    return {
        type: category === 'CONTRACT' ? 'מסמך חוזי' : category === 'PRICELIST' ? 'מחירון' : 'מסמך עבודה',
        category,
        summary: 'מסמך שנקלט למערכת - סיווג לפי שם הקובץ'
    };
}
