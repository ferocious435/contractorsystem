import { NextRequest, NextResponse } from "next/server";
import { requireOwnedProject } from "@/app/api/_utils/auth";
import { archiveContradictionRows, type ContradictionArchiveRow } from "@/utils/contradiction-archive";
import {
    CONTRACT_DOCUMENT_HIERARCHY_GUIDE,
    isProjectContractBaseDocument,
    isReferenceDocument,
    sortContractDocumentsByPrecedence,
} from "@/utils/contract-document-hierarchy";
import { downloadDocumentBuffer, isPdfDocument as isStoredPdfDocument } from "@/utils/document-storage";
import { geminiModel, withRetry } from "@/lib/gemini";
import { createClient } from "@/utils/supabase/server";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;
const MAX_CONTRACT_CONTEXT_CHARS = 180_000;
const MAX_WORK_CONTEXT_CHARS = 80_000;
const MAX_CHARS_PER_CONTRACT_DOC = 35_000;
const MIN_USEFUL_TEXT_LENGTH = 1000;
const CONTRACT_ROLES = new Set(["CONTRACT", "BOQ", "SPECS", "TENDER"]);
const WORK_ROLES = new Set(["EXECUTION", "SITE_REPORT", "PROTOCOL", "INVOICE", "CHANGE_ORDER", "PHOTO", "VIDEO", "LETTER"]);
const ACTIVE_SCAN_STALE_MS = 6 * 60 * 1000;
const SCAN_STATE_COLUMNS = `
    id,
    project_id,
    contract_doc_ids,
    work_doc_id,
    contract_signature,
    work_signature,
    scan_signature,
    status,
    findings_count,
    scanned_at,
    total_work_docs,
    processed_work_docs,
    current_step,
    error_message,
    started_at,
    updated_at,
    completed_at
`;

type ScanRole = "CONTRACT_BASE" | "WORK_EVIDENCE" | "REFERENCE_LIBRARY" | "UNKNOWN";
type ScanStateStatus = "IN_PROGRESS" | "COMPLETED" | "ERROR";

type ScanDocument = Record<string, unknown> & {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
    extracted_text_hash?: string | null;
    content_hash?: string | null;
    updated_at?: string | null;
    processed_at?: string | null;
    created_at?: string | null;
    ai_status?: string | null;
    ocr_status?: string | null;
    parsed_json?: { category?: unknown; type?: unknown } | null;
    __scanRole?: ScanRole;
};

type ScanFinding = Record<string, unknown> & {
    title?: string;
    description?: string;
    category?: string;
    advice?: string;
    clause_reference?: unknown;
    contract_page?: unknown;
    work_page?: unknown;
    original_instruction?: unknown;
    new_requirement?: unknown;
    contract_quote?: unknown;
    work_quote?: unknown;
    contract_document_id?: unknown;
    comparison_type?: unknown;
    risk_reason?: unknown;
    confidence?: unknown;
    next_check?: unknown;
    missing_evidence?: unknown;
    expert_strategy?: unknown;
    document_hierarchy_rule?: unknown;
    document_precedence_assessment?: unknown;
};

type ScanDocumentWithRole = ScanDocument & { __scanRole: ScanRole };

type ScanResult = Record<string, unknown> & { __cached?: boolean };
type ScanResults = ScanResult[] & { __analysisFailures?: string[] };
type DocumentScanStateRow = {
    id?: string;
    project_id: string;
    contract_doc_ids?: string[] | null;
    work_doc_id: string;
    contract_signature?: string | null;
    work_signature?: string | null;
    scan_signature: string;
    status?: string | null;
    findings_count?: number | null;
    scanned_at?: string | null;
    total_work_docs?: number | null;
    processed_work_docs?: number | null;
    current_step?: string | null;
    error_message?: string | null;
    started_at?: string | null;
    updated_at?: string | null;
    completed_at?: string | null;
};

function extractFirstJsonArray(text: string) {
    const cleanText = text.replace(/```json|```/g, "").trim();
    const start = cleanText.indexOf("[");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = start; i < cleanText.length; i++) {
        const char = cleanText[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === "\\") {
            escapeNext = true;
            continue;
        }

        if (char === "\"") {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === "[") depth++;
        if (char === "]") depth--;

        if (depth === 0) {
            return cleanText.slice(start, i + 1);
        }
    }

    return null;
}

function parseGeminiJsonArray(text: string): ScanFinding[] {
    const jsonArray = extractFirstJsonArray(text);
    if (!jsonArray) {
        throw new Error("Gemini did not return a JSON array");
    }
    return JSON.parse(jsonArray);
}

function sha256(input: string) {
    return createHash("sha256").update(input).digest("hex");
}

function sha256Buffer(input: Buffer) {
    return createHash("sha256").update(input).digest("hex");
}

function hasUsefulText(doc: ScanDocument) {
    return String(doc.extracted_text || "").trim().length >= MIN_USEFUL_TEXT_LENGTH;
}

function isPdfDocument(doc: ScanDocument) {
    return isStoredPdfDocument(doc);
}

function getDocumentSignature(doc: ScanDocument) {
    const textHash = doc.extracted_text_hash || sha256(String(doc.extracted_text || ""));
    return `${doc.id}:${doc.content_hash || "no-file-hash"}:${textHash}:${doc.updated_at || doc.processed_at || doc.created_at || ""}`;
}

function buildContractSignature(contractDocs: ScanDocument[]) {
    return sha256(contractDocs.map(getDocumentSignature).sort().join("|"));
}

function buildScanSignature(projectId: string, contractSignature: string, workSignature: string) {
    return sha256(`${projectId}:${contractSignature}:${workSignature}`);
}

function nowIso() {
    return new Date().toISOString();
}

function isFreshInProgressScan(row: DocumentScanStateRow) {
    if (row.status !== "IN_PROGRESS" || !row.updated_at) return false;
    return Date.now() - new Date(row.updated_at).getTime() < ACTIVE_SCAN_STALE_MS;
}

function summarizeScanState(rows: DocumentScanStateRow[]) {
    const activeRow = rows.find(isFreshInProgressScan);
    const latestRow = activeRow || rows[0] || null;
    const explicitTotal = Math.max(
        latestRow?.total_work_docs || 0,
        ...rows.map((row) => row.total_work_docs || 0)
    );
    const relevantRows = explicitTotal > 0
        ? rows.filter((row) => row.total_work_docs === explicitTotal || row.status === "IN_PROGRESS")
        : rows;
    const total = explicitTotal || relevantRows.length;
    const processedFallback = relevantRows.filter(
        (row) => row.status === "COMPLETED" || row.status === "ERROR"
    );
    const processed = Math.min(
        total,
        Math.max(
            latestRow?.processed_work_docs || 0,
            processedFallback.length
        )
    );
    const staleInProgressRow = rows.find((row) => row.status === "IN_PROGRESS" && !isFreshInProgressScan(row));
    const isPaused = !activeRow && total > 0 && (processed < total || Boolean(staleInProgressRow));
    const status = activeRow
        ? "IN_PROGRESS"
        : isPaused
            ? "PAUSED"
            : latestRow?.status || "IDLE";
    const progress = total > 0 ? Math.round((processed / total) * 100) : 0;

    return {
        active: Boolean(activeRow),
        status,
        progress: Math.min(100, Math.max(0, progress)),
        processed,
        total,
        currentStep: activeRow?.current_step || staleInProgressRow?.current_step || latestRow?.current_step || null,
        errorMessage: latestRow?.status === "ERROR" ? latestRow.error_message || null : null,
        updatedAt: latestRow?.updated_at || null,
        completedAt: latestRow?.completed_at || null,
        found: relevantRows
            .filter((row) => row.status === "COMPLETED")
            .reduce((sum, row) => sum + (row.findings_count || 0), 0),
    };
}

async function loadProjectScanState(supabase: SupabaseClient, projectId: string, workDocId?: string | null) {
    let query = supabase
        .from("document_scan_state")
        .select(SCAN_STATE_COLUMNS)
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false })
        .limit(200);

    if (workDocId) {
        query = query.eq("work_doc_id", workDocId);
    }

    const { data, error } = await query;

    if (error) {
        throw error;
    }

    return summarizeScanState((data || []) as DocumentScanStateRow[]);
}

async function saveScanState(
    supabase: SupabaseClient,
    state: DocumentScanStateRow & {
        status: ScanStateStatus;
        contract_doc_ids: string[];
        contract_signature: string;
        work_signature: string;
    }
) {
    const { error } = await supabase
        .from("document_scan_state")
        .upsert(state, { onConflict: "scan_signature" });

    if (error) {
        throw error;
    }
}

function getDocumentRole(doc: ScanDocument): ScanRole {
    const rawCategory = String(doc.category || doc.parsed_json?.category || "").toUpperCase();
    const title = String(doc.title || "").toLowerCase();
    const parsedType = String(doc.parsed_json?.type || "").toLowerCase();
    const searchText = `${title} ${parsedType}`;

    if (isReferenceDocument(doc)) {
        return "REFERENCE_LIBRARY";
    }

    if (
        CONTRACT_ROLES.has(rawCategory) ||
        isProjectContractBaseDocument(doc) ||
        /contract|boq|tender|spec|חוזה|הסכם|כתב\s*כמויות|מפרט|מכרז/.test(searchText)
    ) {
        return "CONTRACT_BASE";
    }

    if (
        WORK_ROLES.has(rawCategory) ||
        /execution|site|report|protocol|invoice|change|photo|video|letter|ביצוע|יומן|שטח|פרוטוקול|חשבון|חריג|מכתב|תמונה|וידאו/.test(searchText)
    ) {
        return "WORK_EVIDENCE";
    }

    return "UNKNOWN";
}

function buildBoundedDocumentContext(docs: ScanDocument[], maxTotalChars: number, maxPerDoc: number) {
    let usedChars = 0;
    const includedDocs: ScanDocument[] = [];
    const sections: string[] = [];

    for (const doc of docs) {
        const rawText = String(doc.extracted_text || "").trim();
        if (!rawText) continue;
        const remaining = maxTotalChars - usedChars;
        if (remaining <= 0) break;

        const sliceLength = Math.min(rawText.length, maxPerDoc, remaining);
        const textSlice = rawText.slice(0, sliceLength);
        usedChars += textSlice.length;
        includedDocs.push(doc);
        sections.push(`--- Document ID: ${doc.id}
Title: ${doc.title}
Category: ${doc.category}
Chars included: ${textSlice.length}/${rawText.length} ---
${textSlice}`);
    }

    return {
        context: sections.join("\n\n"),
        includedDocs,
        usedChars,
        truncated: docs.some(doc => String(doc.extracted_text || "").length > maxPerDoc) || usedChars >= maxTotalChars
    };
}

async function extractPdfTextForScan<T extends ScanDocument>(supabase: SupabaseClient, doc: T): Promise<T> {
    if (!isPdfDocument(doc)) {
        return doc;
    }

    const pdfBuffer = await downloadDocumentBuffer(supabase, doc);
    const contentHash = sha256Buffer(pdfBuffer);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PDFParse } = require("pdf-parse");
    const parser = new PDFParse({ data: pdfBuffer });
    const pdfData = await parser.getText();
    await parser.destroy();

    const extractedText = pdfData.text || "";
    const extractedTextHash = sha256(extractedText);
    const nextAiStatus = doc.ai_status === "VALIDATED"
        ? "VALIDATED"
        : extractedText.length >= MIN_USEFUL_TEXT_LENGTH ? "SCANNED" : doc.ai_status;

    const { error } = await supabase
        .from("documents")
        .update({
            extracted_text: extractedText,
            ocr_status: extractedText.length >= MIN_USEFUL_TEXT_LENGTH ? "COMPLETED" : "REQUIRES_REVIEW",
            ai_status: nextAiStatus,
            content_hash: contentHash,
            extracted_text_hash: extractedTextHash,
            processed_at: new Date().toISOString()
        })
        .eq("id", doc.id);

    if (error) {
        throw new Error(`Failed to save extracted text for "${doc.title}": ${error.message}`);
    }

    return {
        ...doc,
        extracted_text: extractedText,
        ocr_status: extractedText.length >= MIN_USEFUL_TEXT_LENGTH ? "COMPLETED" : "REQUIRES_REVIEW",
        ai_status: nextAiStatus,
        content_hash: contentHash,
        extracted_text_hash: extractedTextHash,
        processed_at: new Date().toISOString()
    } as T;
}

async function ensureScanTextForDocuments<T extends ScanDocument>(supabase: SupabaseClient, documents: T[]) {
    const prepared: T[] = [];
    const failures: string[] = [];

    for (const doc of documents) {
        if (hasUsefulText(doc)) {
            prepared.push(doc);
            continue;
        }

        try {
            prepared.push(await extractPdfTextForScan(supabase, doc));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[scan] Text preparation failed for ${doc.title}:`, error);
            failures.push(`${doc.title}: ${message}`);
            prepared.push(doc);
        }
    }

    return { prepared, failures };
}

function cleanAiText(text: unknown) {
    if (typeof text !== "string") return text;
    return text.replace(/\s*Powered by[^\.\n]*/gi, "").replace(/\s*מופעל על ידי[^\.\n]*/gi, "").trim() || text;
}

function normalizeConfidence(value: unknown) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
    if (numericValue <= 1) return numericValue;
    if (numericValue <= 100) return numericValue / 100;
    return 1;
}

function normalizeEvidenceStatus(item: ScanFinding) {
    const category = String(item.category || "").toLowerCase();
    const comparisonType = String(item.comparison_type || "").toLowerCase();
    const hasQuotes = Boolean(item.contract_quote && item.work_quote);

    if (!hasQuotes) {
        return "REQUIRES_VERIFICATION";
    }

    if (category.includes("חוסר נתונים") || comparisonType.includes("missing_data")) {
        return "REQUIRES_VERIFICATION";
    }

    return "VERIFIED";
}

function mapSeverity(category: string) {
    if (/סתירה|contradiction/i.test(category)) return "HIGH";
    if (/שינוי|change|חריג|extra/i.test(category)) return "MEDIUM";
    return "LOW";
}

function buildScanPrompt(params: {
    contractContext: string;
    workDoc: ScanDocument;
    workText: string;
    contractContextBundle: ReturnType<typeof buildBoundedDocumentContext>;
}) {
    const { contractContext, workDoc, workText, contractContextBundle } = params;

    return `
You are ContractorSystem's construction-claims analyst for an Israeli contractor.
The system exists for the contractor: protect payment, margin, schedule, and evidence.

Compare the contractual base documents against the current work/site document.
Return only a valid JSON array. All user-facing text must be short, practical Hebrew.

DOCUMENT HIERARCHY / PRECEDENCE GUIDE:
${CONTRACT_DOCUMENT_HIERARCHY_GUIDE}

CONTRACTUAL BASE:
${contractContext}

WORK / SITE DOCUMENT:
--- Document ID: ${workDoc.id}
Title: ${workDoc.title}
Category: ${workDoc.category}
Chars included: ${workText.length}/${String(workDoc.extracted_text || "").length} ---
${workText}

IMPORTANT SCAN RULES:
1. Classify every finding as one of: סתירה, שינוי/חריג, אירוע שטח, חוסר נתונים, אין התאמה ישירה.
2. A true contradiction requires conflict between a contract/BOQ/spec instruction and actual work/site evidence.
3. Do not treat every site event as a contradiction. If it is only a field event, say so.
4. Evidence status can be VERIFIED only when both contract_quote and work_quote are real quotes from the provided context.
5. If one quote is missing, use REQUIRES_VERIFICATION and list exactly what is missing.
6. Never invent a clause, document, page, price, or confident conclusion without evidence.
7. If no direct contract/BOQ match exists, create a Zero-Match finding: explain that no direct match was found, why it matters to the contractor, what to check next, and confidence.
8. Mention financial impact only as a practical direction unless a price appears in the documents.
9. Keep outputs businesslike and useful for a contractor, not technical noise.
10. The contract context may be truncated: ${contractContextBundle.truncated ? "yes" : "no"}. If this limits certainty, say that verification is required.
11. For every finding, state how document hierarchy was applied: contract source controls, documents complement each other, stricter requirement controls pending manager decision, manager/supervisor decision is required, or the work document is only supporting evidence.

Return JSON array with this exact object shape:
[
  {
    "title": "כותרת קצרה בעברית",
    "description": "מה לא מסתדר ומה המשמעות לקבלן",
    "category": "סתירה / שינוי/חריג / אירוע שטח / חוסר נתונים / אין התאמה ישירה",
    "advice": "מה הקבלן צריך לבדוק או לעשות עכשיו",
    "clause_reference": "סעיף רלוונטי או null",
    "contract_page": "עמוד/מיקום במסמך החוזי או null",
    "work_page": "עמוד/מיקום במסמך העבודה או null",
    "original_instruction": "מה נדרש לפי החוזה או null",
    "new_requirement": "מה קרה בפועל או מה נדרש בשטח",
    "contract_quote": "ציטוט מדויק מהחוזה/BOQ או null",
    "work_quote": "ציטוט מדויק ממסמך העבודה/שטח או null",
    "contract_document_id": "Document ID from contractual base or null",
    "work_document_id": "${workDoc.id}",
    "evidence_status": "VERIFIED / REQUIRES_VERIFICATION",
    "missing_evidence": ["מסמכים/בדיקות שחסרים לאימות"],
    "comparison_type": "contract_vs_execution / boq_vs_execution / specs_vs_execution / zero_match / missing_data / site_event",
    "document_hierarchy_rule": "contract_source_controls / documents_complement_each_other / stricter_requirement_controls / manager_decision_required / work_document_is_supporting_evidence",
    "document_precedence_assessment": "הסבר קצר בעברית איזה מסמך גובר, האם המסמכים משלימים זה את זה, או איזו הכרעת מנהל/מפקח נדרשת",
    "risk_reason": "למה זה חשוב לקבלן",
    "confidence": 0.0,
    "next_check": "בדיקה מעשית הבאה",
    "expert_strategy": {
      "ripple_effect": {
        "technical_analysis": "השפעה הנדסית קצרה",
        "work_disruption": "השפעה על רצף עבודה/זמן",
        "implied_items": ["סעיפים או עבודות נלוות אפשריות"]
      },
      "contractual_diagnostic": {
        "legal_basis": "בסיס חוזי/מסחרי או נדרש אימות",
        "argument_for_supervisor": "טיעון קצר מול מפקח/מזמין"
      },
      "operational_instructions": {
        "site_diary_draft": "נוסח קצר ליומן עבודה",
        "required_evidence": ["תמונות", "אישור מפקח", "מדידות", "מסמך נוסף"]
      },
      "financial_impact_desc": "משמעות כספית אפשרית ללא המצאת מחיר",
      "risk_assessment": "סיכון אם לא יתועד/יתומחר"
    }
  }
]`;
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const projectId = searchParams.get("projectId");
        const workDocId = searchParams.get("workDocId");

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        const scanStatus = await loadProjectScanState(supabase, projectId, workDocId);

        return NextResponse.json({
            success: true,
            ...scanStatus,
        });
    } catch (error: unknown) {
        console.error("[scan] Status API Error:", error);
        const message = error instanceof Error ? error.message : "Failed to load scan status";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { projectId, force = false, workDocId = null } = body;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        if (!force) {
            const currentScanStatus = await loadProjectScanState(supabase, projectId, workDocId);
            if (currentScanStatus.active) {
                return NextResponse.json({
                    success: true,
                    active: true,
                    resumed: false,
                    found: currentScanStatus.found,
                    message: "Scan is already running. The saved progress can be polled from this endpoint.",
                    scanStatus: currentScanStatus,
                });
            }
        }

        if (force) {
            const { data: rowsToArchive, error: archiveSelectError } = await supabase
                .from("contradictions")
                .select("id, evidence_data")
                .eq("project_id", projectId)
                .neq("status", "ARCHIVED");

            if (archiveSelectError) {
                throw archiveSelectError;
            }

            await archiveContradictionRows(
                supabase,
                (rowsToArchive || []) as ContradictionArchiveRow[],
                {
                    archive_reason: "Project was rescanned. Previous findings are kept only as historical evidence.",
                    archived_at: new Date().toISOString(),
                }
            );
            await supabase.from("document_scan_state").delete().eq("project_id", projectId);
        } else if (workDocId) {
            const { data: rowsToArchive, error: archiveSelectError } = await supabase
                .from("contradictions")
                .select("id, evidence_data")
                .eq("project_id", projectId)
                .eq("source_execution_doc_id", workDocId)
                .neq("status", "ARCHIVED");

            if (archiveSelectError) {
                throw archiveSelectError;
            }

            await archiveContradictionRows(
                supabase,
                (rowsToArchive || []) as ContradictionArchiveRow[],
                {
                    archive_reason: "Work document was rescanned. Previous findings are kept only as historical evidence.",
                    archived_at: new Date().toISOString(),
                    rescanned_work_doc_id: workDocId,
                }
            );
            await supabase.from("document_scan_state").delete().eq("project_id", projectId).eq("work_doc_id", workDocId);
        }

        const { data: documentRows } = await supabase.from("documents").select("*").eq("project_id", projectId);
        const documents = (documentRows || []) as ScanDocument[];
        if (documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        const unvalidatedDocumentsCount = documents.filter((doc) => doc.ai_status !== "VALIDATED").length;
        const validatedDocuments = documents.filter((doc) => doc.ai_status === "VALIDATED");

        if (validatedDocuments.length === 0) {
            return NextResponse.json({
                success: false,
                error: "Validate contract and execution documents before scanning for contradictions.",
                unvalidatedDocumentsCount
            }, { status: 400 });
        }

        let documentsWithRoles: ScanDocumentWithRole[] = validatedDocuments.map((doc): ScanDocumentWithRole => ({ ...doc, __scanRole: getDocumentRole(doc) }));
        let contractDocs = documentsWithRoles.filter((d) => d.__scanRole === "CONTRACT_BASE");
        let workDocs = documentsWithRoles.filter((d) => d.__scanRole === "WORK_EVIDENCE");

        if (workDocId) {
            workDocs = workDocs.filter((d) => d.id === workDocId);
        }

        if (contractDocs.length === 0) {
            return NextResponse.json({
                success: false,
                error: "לא נמצאו מסמכי בסיס להשוואה. יש להעלות או לסווג חוזה, כתב כמויות, מפרט או מכרז לפני סריקת סתירות."
            }, { status: 400 });
        }

        if (workDocs.length === 0) {
            return NextResponse.json({
                success: false,
                error: workDocId ? "מסמך הביצוע המבוקש לא נמצא" : "לא נמצאו מסמכי ביצוע או שטח לסריקה"
            }, { status: 400 });
        }

        const docsForTextPreparation = [...contractDocs, ...workDocs];
        const missingUsefulTextCount = docsForTextPreparation.filter((doc) => !hasUsefulText(doc)).length;

        let textPreparationFailures: string[] = [];

        if (missingUsefulTextCount > 0) {
            const { prepared, failures } = await ensureScanTextForDocuments(supabase, docsForTextPreparation);
            textPreparationFailures = failures;
            const preparedById = new Map(prepared.map((doc) => [doc.id, doc]));

            documentsWithRoles = documentsWithRoles.map((doc) => preparedById.get(doc.id) || doc);
            contractDocs = documentsWithRoles.filter((d) => d.__scanRole === "CONTRACT_BASE");
            workDocs = documentsWithRoles.filter((d) => d.__scanRole === "WORK_EVIDENCE");

            if (workDocId) {
                workDocs = workDocs.filter((d) => d.id === workDocId);
            }

            if (failures.length > 0) {
                console.warn(`[scan] Text preparation completed with ${failures.length} failures`);
            }
        }

        if (!contractDocs.some((doc) => hasUsefulText(doc))) {
            return NextResponse.json({
                success: false,
                error: "Contract documents exist, but no readable text could be extracted for comparison. Open the contract documents page and run document scan on at least one contract/BOQ PDF."
            }, { status: 400 });
        }

        if (!workDocs.some((doc) => hasUsefulText(doc))) {
            return NextResponse.json({
                success: false,
                error: "Execution documents exist, but no readable text could be extracted for comparison. Open the execution documents page and run document scan on at least one execution PDF."
            }, { status: 400 });
        }

        const foundContradictions = await analyzeDirectly(supabase, projectId, contractDocs, workDocs, force);
        const analysisFailures = foundContradictions.__analysisFailures || [];
        const warnings = [...textPreparationFailures, ...analysisFailures];
        const scanStatus = await loadProjectScanState(supabase, projectId, workDocId);

        return NextResponse.json({
            success: warnings.length === 0,
            partial: warnings.length > 0,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            cached: foundContradictions.length > 0 && foundContradictions.every((item) => item.__cached === true),
            skippedUnvalidatedDocuments: unvalidatedDocumentsCount,
            warnings,
            scanStatus
        });

    } catch (error: unknown) {
        console.error("[scan] API Error:", error);
        const message = error instanceof Error ? error.message : "Scan failed";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

async function analyzeDirectly(supabase: SupabaseClient, projectId: string, contractDocs: ScanDocument[], workDocs: ScanDocument[], force = false): Promise<ScanResults> {
    const results: ScanResults = [] as ScanResults;
    const analysisFailures: string[] = [];
    const contractSignature = buildContractSignature(contractDocs);
    const contractDocIds = contractDocs.map((doc) => String(doc.id)).sort();

    const contractContextBundle = buildBoundedDocumentContext(
        sortContractDocumentsByPrecedence(contractDocs.filter(d => d.extracted_text)),
        MAX_CONTRACT_CONTEXT_CHARS,
        MAX_CHARS_PER_CONTRACT_DOC
    );
    const contractContext = contractContextBundle.context;

    if (!contractContext.trim()) {
        throw new Error("Contract documents exist, but no extracted text is available for comparison.");
    }

    const scannableWorkDocs = workDocs.filter((doc) => Boolean(doc.extracted_text));
    let processedWorkDocs = 0;

    for (const workDoc of scannableWorkDocs) {
        const workText = String(workDoc.extracted_text || "").slice(0, MAX_WORK_CONTEXT_CHARS);
        const workSignature = getDocumentSignature(workDoc);
        const scanSignature = buildScanSignature(projectId, contractSignature, workSignature);
        const stateBase = {
            project_id: projectId,
            contract_doc_ids: contractDocIds,
            work_doc_id: workDoc.id,
            contract_signature: contractSignature,
            work_signature: workSignature,
            scan_signature: scanSignature,
            total_work_docs: scannableWorkDocs.length,
        };

        try {
            if (!force) {
                const { data: scanStateRow } = await supabase
                    .from("document_scan_state")
                    .select(SCAN_STATE_COLUMNS)
                    .eq("scan_signature", scanSignature)
                    .maybeSingle();
                const scanState = scanStateRow as DocumentScanStateRow | null;

                if (scanState?.status === "COMPLETED") {
                    const { data: cachedContradictions } = await supabase
                        .from("contradictions")
                        .select("*")
                        .eq("project_id", projectId)
                        .eq("scan_signature", scanSignature)
                        .neq("status", "ARCHIVED");

                    if (cachedContradictions?.length) {
                        cachedContradictions.forEach((item) => results.push({ ...item, __cached: true }));
                        await saveScanState(supabase, {
                            ...stateBase,
                            status: "COMPLETED",
                            findings_count: scanState.findings_count ?? cachedContradictions.length,
                            processed_work_docs: processedWorkDocs + 1,
                            current_step: `הושלם: ${workDoc.title || "מסמך ביצוע"}`,
                            error_message: null,
                            scanned_at: scanState.scanned_at || nowIso(),
                            updated_at: nowIso(),
                            completed_at: scanState.completed_at || nowIso(),
                        });
                        processedWorkDocs += 1;
                        continue;
                    }

                    if ((scanState.findings_count || 0) === 0) {
                        await saveScanState(supabase, {
                            ...stateBase,
                            status: "COMPLETED",
                            findings_count: 0,
                            processed_work_docs: processedWorkDocs + 1,
                            current_step: `הושלם ללא ממצאים: ${workDoc.title || "מסמך ביצוע"}`,
                            error_message: null,
                            scanned_at: scanState.scanned_at || nowIso(),
                            updated_at: nowIso(),
                            completed_at: scanState.completed_at || nowIso(),
                        });
                        processedWorkDocs += 1;
                        continue;
                    }

                    await supabase
                        .from("document_scan_state")
                        .delete()
                        .eq("scan_signature", scanSignature);
                }

                const { data: oldFindings } = await supabase
                    .from("contradictions")
                    .select("id, evidence_data")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED")
                    .or(`scan_signature.is.null,scan_signature.neq.${scanSignature}`);

                if (oldFindings?.length) {
                    await archiveContradictionRows(
                        supabase,
                        oldFindings as ContradictionArchiveRow[],
                        {
                            archive_reason: "Finding was created before the current scan cache signature or documents changed.",
                            archived_at: new Date().toISOString(),
                            current_scan_signature: scanSignature,
                        }
                    );
                }
            }

            await saveScanState(supabase, {
                ...stateBase,
                status: "IN_PROGRESS",
                findings_count: 0,
                processed_work_docs: processedWorkDocs,
                current_step: `בודק ${processedWorkDocs + 1}/${scannableWorkDocs.length}: ${workDoc.title || "מסמך ביצוע"}`,
                error_message: null,
                started_at: nowIso(),
                updated_at: nowIso(),
                completed_at: null,
            });

            const prompt = buildScanPrompt({ contractContext, workDoc, workText, contractContextBundle });
            const result = await withRetry(() => geminiModel.generateContent(prompt));
            const responseText = result.response.text();
            const points = parseGeminiJsonArray(responseText);

            for (const p of points) {
                const category = String(p.category || "");
                const matchedContractDoc = p.contract_document_id
                    ? contractDocs.find((doc) => doc.id === p.contract_document_id)
                    : null;
                const missingEvidence = Array.isArray(p.missing_evidence) ? [...p.missing_evidence] : [];

                if (!matchedContractDoc) {
                    missingEvidence.push("contract_document_id was not matched to a validated contract document");
                }

                const { data, error } = await supabase.from("contradictions").insert({
                    project_id: projectId,
                    title: cleanAiText(p.title),
                    description: cleanAiText(p.description),
                    severity: mapSeverity(category),
                    category,
                    strategy_advice: cleanAiText(p.advice),
                    source_execution_doc_id: workDoc.id,
                    target_contract_doc_id: matchedContractDoc?.id,
                    status: "OPEN",
                    scan_signature: scanSignature,
                    evidence_data: {
                        evidence_status: matchedContractDoc ? normalizeEvidenceStatus(p) : "REQUIRES_VERIFICATION",
                        missing_evidence: missingEvidence,
                        clause_reference: p.clause_reference,
                        contract_page: p.contract_page || null,
                        work_page: p.work_page || null,
                        original_instruction: p.original_instruction,
                        new_requirement: p.new_requirement,
                        contract_quote: p.contract_quote,
                        work_quote: p.work_quote,
                        contract_title: matchedContractDoc?.title || null,
                        work_title: workDoc.title,
                        contract_url: null,
                        work_url: null,
                        comparison_type: p.comparison_type || null,
                        document_hierarchy_rule: p.document_hierarchy_rule || null,
                        document_precedence_assessment: cleanAiText(p.document_precedence_assessment) || null,
                        risk_reason: p.risk_reason || null,
                        confidence: normalizeConfidence(p.confidence),
                        next_check: p.next_check || null,
                        document_pair: {
                            contract_doc_id: matchedContractDoc?.id || null,
                            contract_title: matchedContractDoc?.title || null,
                            work_doc_id: workDoc.id,
                            work_title: workDoc.title
                        },
                        context_window: {
                            contract_chars_used: contractContextBundle.usedChars,
                            contract_context_truncated: contractContextBundle.truncated,
                            work_chars_used: workText.length,
                            work_context_truncated: String(workDoc.extracted_text || "").length > workText.length
                        },
                        expert_strategy: p.expert_strategy || {}
                    }
                }).select().single();

                if (error) {
                    throw new Error(`Failed to save scan finding for "${workDoc.title}": ${error.message}`);
                }

                if (data) results.push(data);
            }

            const completedAt = nowIso();
            await saveScanState(supabase, {
                ...stateBase,
                status: "COMPLETED",
                findings_count: points.length,
                processed_work_docs: processedWorkDocs + 1,
                current_step: `הושלם: ${workDoc.title || "מסמך ביצוע"}`,
                error_message: null,
                scanned_at: completedAt,
                updated_at: completedAt,
                completed_at: completedAt,
            });
            processedWorkDocs += 1;
        } catch (err) {
            console.error(`[scan] Analysis error for ${workDoc.title}:`, err);
            const message = err instanceof Error ? err.message : String(err);
            analysisFailures.push(`${workDoc.title}: ${message}`);
            const failedAt = nowIso();

            try {
                await saveScanState(supabase, {
                    ...stateBase,
                    status: "ERROR",
                    findings_count: 0,
                    processed_work_docs: processedWorkDocs + 1,
                    current_step: `שגיאה: ${workDoc.title || "מסמך ביצוע"}`,
                    error_message: message,
                    scanned_at: failedAt,
                    updated_at: failedAt,
                    completed_at: failedAt,
                });
            } catch (errorStateError) {
                console.error(`[scan] Failed to save error state for ${workDoc.title}:`, errorStateError);
            }
            processedWorkDocs += 1;
        }
    }

    results.__analysisFailures = analysisFailures;
    return results;
}
