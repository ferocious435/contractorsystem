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
import {
    buildDocumentScanChunks,
    formatContractChunkContext,
    formatRelatedWorkTimeline,
    selectRelevantContractChunks,
    selectRelevantProjectChunks,
    type DocumentScanChunk,
} from "@/utils/document-scan-chunks";
import {
    buildDocumentFingerprint,
    buildDocumentSetFingerprint,
    buildScanMemorySignature,
    hashScanValue,
} from "@/utils/document-scan-memory";
import { quoteExistsInSource } from "@/utils/local-ai-preview";
import { parseScanFindings } from "@/utils/scan-ai-response";
import { generateComparisonText, getComparisonAiIdentity } from "@/lib/comparison-ai";
import { createClient } from "@/utils/supabase/server";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;
const CONTRACT_CHUNK_CHARS = 4_000;
const WORK_CHUNK_CHARS = 6_000;
const CHUNK_OVERLAP_CHARS = 300;
const MAX_SELECTED_CONTRACT_CHARS = 4_000;
const MAX_SELECTED_CONTRACT_CHUNKS = 1;
const MAX_RELATED_WORK_CHARS = 2_400;
const MAX_RELATED_WORK_CHUNKS = 4;
const SCAN_ENGINE_VERSION = "project-timeline-memory-v3";
const MIN_USEFUL_TEXT_LENGTH = 1000;
const CONTRACT_ROLES = new Set(["CONTRACT", "BOQ", "SPECS", "TENDER"]);
const WORK_ROLES = new Set(["EXECUTION", "SITE_REPORT", "PROTOCOL", "INVOICE", "CHANGE_ORDER", "PHOTO", "VIDEO", "LETTER"]);
const SCAN_CONTRACT_HIERARCHY_GUIDE = CONTRACT_DOCUMENT_HIERARCHY_GUIDE
    .split("\n")
    .filter((line) => /First follow|Project contract documents|Shelf contracts|Execution documents|If contract documents conflict|For variations/.test(line))
    .join("\n");
const ACTIVE_SCAN_STALE_MS = 45_000;
const SCAN_HEARTBEAT_MS = 15_000;
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
    storage_bucket?: string | null;
    storage_path?: string | null;
    file_url?: string | null;
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
    work_document_id?: unknown;
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
type ScanResults = ScanResult[] & {
    __analysisFailures?: string[];
    __cachedDocuments?: number;
    __scannedDocuments?: number;
};
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

async function generateScanChunkFindings(prompt: string) {
    const attempts = [
        { numPredict: 512, timeoutMs: 100_000, retryInstruction: "" },
        {
            numPredict: 384,
            timeoutMs: 75_000,
            retryInstruction: "\nRETRY: Return at most one decisive finding. Keep every value very short and return valid JSON only.",
        },
    ];
    let lastError: unknown = new Error("Local AI did not return a valid scan result");

    for (const attempt of attempts) {
        try {
            const responseText = await generateComparisonText(
                `${prompt}${attempt.retryInstruction}`,
                process.env,
                {
                    numCtx: 8_192,
                    numPredict: attempt.numPredict,
                    timeoutMs: attempt.timeoutMs,
                },
            );
            return parseScanFindings(responseText) as ScanFinding[];
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
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
    return buildDocumentFingerprint(doc);
}

function buildContractSignature(contractDocs: ScanDocument[]) {
    return buildDocumentSetFingerprint(contractDocs);
}

function buildScanSignature(
    projectId: string,
    contractSignature: string,
    relatedWorkSignature: string,
    workSignature: string,
    aiIdentity: string,
) {
    return buildScanMemorySignature({
        engineVersion: SCAN_ENGINE_VERSION,
        projectId,
        contractFingerprint: contractSignature,
        workFingerprint: workSignature,
        relatedWorkFingerprint: relatedWorkSignature,
        aiIdentity,
    });
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
    const isPaused = !activeRow && total > 0 && processed < total;
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

async function withScanHeartbeat<T>(
    supabase: SupabaseClient,
    scanSignature: string,
    operation: () => Promise<T>,
) {
    let stopped = false;
    const timer = setInterval(() => {
        if (stopped) return;

        void supabase
            .from("document_scan_state")
            .update({ updated_at: nowIso() })
            .eq("scan_signature", scanSignature)
            .then(({ error }) => {
                if (error) {
                    console.warn(`[scan] Heartbeat failed for ${scanSignature.slice(0, 12)}: ${error.message}`);
                }
            });
    }, SCAN_HEARTBEAT_MS);

    try {
        return await operation();
    } finally {
        stopped = true;
        clearInterval(timer);
    }
}

function getDocumentRole(doc: ScanDocument): ScanRole {
    const storedCategory = String(doc.category || "").toUpperCase();
    const parsedCategory = String(doc.parsed_json?.category || "").toUpperCase();
    const rawCategory = storedCategory || parsedCategory;
    const title = String(doc.title || "").toLowerCase();
    const parsedType = String(doc.parsed_json?.type || "").toLowerCase();
    const searchText = `${title} ${parsedType}`;

    // The upload section is an explicit user choice. Keep execution documents in
    // the project timeline even when an older or failed AI analysis mistakenly
    // marked them as reference material.
    if (WORK_ROLES.has(storedCategory)) {
        return "WORK_EVIDENCE";
    }

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
    const extractedTextHash = hashScanValue(extractedText);
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

function normalizeEvidenceStatus(item: ScanFinding, contractQuoteMatched: boolean, workQuoteMatched: boolean) {
    const category = String(item.category || "").toLowerCase();
    const comparisonType = String(item.comparison_type || "").toLowerCase();

    if (!contractQuoteMatched || !workQuoteMatched) {
        return "REQUIRES_VERIFICATION";
    }

    if (category.includes("חוסר נתונים") || comparisonType.includes("missing_data")) {
        return "REQUIRES_VERIFICATION";
    }

    return "VERIFIED";
}

function dedupeScanFindings(findings: ScanFinding[]) {
    const unique = new Map<string, ScanFinding>();

    for (const finding of findings) {
        const key = [
            finding.category,
            finding.contract_document_id,
            finding.contract_quote,
            finding.work_quote,
            finding.title,
        ].map((value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()).join('|');

        if (!unique.has(key)) unique.set(key, finding);
    }

    return [...unique.values()];
}

function isTemplatePlaceholderFinding(finding: Pick<ScanFinding, "title" | "description" | "advice">) {
    const values = [finding.title, finding.description, finding.advice]
        .map((value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase());
    const placeholders = [
        "כותרת קצרה בעברית",
        "מה לא מסתדר ומה המשמעות לקבלן",
        "מה הקבלן צריך לבדוק או לעשות עכשיו",
        "short title in hebrew",
    ];

    return values.some((value) => placeholders.includes(value));
}

async function archiveTemplatePlaceholderFindings(supabase: SupabaseClient, projectId: string) {
    const { data: candidates, error: candidateError } = await supabase
        .from("contradictions")
        .select("id, title, description, strategy_advice, scan_signature")
        .eq("project_id", projectId)
        .neq("status", "ARCHIVED");
    if (candidateError) throw candidateError;

    const invalidFindings = (candidates || []).filter((finding) => isTemplatePlaceholderFinding({
        title: finding.title,
        description: finding.description,
        advice: finding.strategy_advice,
    }));
    if (invalidFindings.length === 0) return 0;

    const { error: archiveError } = await supabase
        .from("contradictions")
        .update({ status: "ARCHIVED" })
        .in("id", invalidFindings.map((finding) => String(finding.id)));
    if (archiveError) throw archiveError;

    const affectedSignatures = [...new Set(
        invalidFindings
            .map((finding) => String(finding.scan_signature || ""))
            .filter(Boolean),
    )];

    for (const scanSignature of affectedSignatures) {
        const { count, error: countError } = await supabase
            .from("contradictions")
            .select("id", { count: "exact", head: true })
            .eq("project_id", projectId)
            .eq("scan_signature", scanSignature)
            .neq("status", "ARCHIVED");
        if (countError) throw countError;

        const { error: stateUpdateError } = await supabase
            .from("document_scan_state")
            .update({ findings_count: count || 0, updated_at: nowIso() })
            .eq("scan_signature", scanSignature);
        if (stateUpdateError) throw stateUpdateError;
    }

    return invalidFindings.length;
}

function mapSeverity(category: string) {
    if (/סתירה|contradiction/i.test(category)) return "HIGH";
    if (/שינוי|change|חריג|extra/i.test(category)) return "MEDIUM";
    return "LOW";
}

function buildScanPrompt(params: {
    contractContext: string;
    relatedWorkContext: string;
    workDoc: ScanDocument;
    workChunk: DocumentScanChunk;
    contractChunksIndexed: number;
    contractSourceChars: number;
    projectWorkChunksIndexed: number;
}) {
    const {
        contractContext,
        relatedWorkContext,
        workDoc,
        workChunk,
        contractChunksIndexed,
        contractSourceChars,
        projectWorkChunksIndexed,
    } = params;

    return `
You are ContractorSystem's construction-claims analyst for an Israeli contractor.
The system exists for the contractor: protect payment, margin, schedule, and evidence.

Compare the contractual base documents against the current work/site document.
Return only a valid JSON array. All user-facing text must be short, practical Hebrew.

DOCUMENT HIERARCHY / PRECEDENCE GUIDE:
${SCAN_CONTRACT_HIERARCHY_GUIDE}

CONTRACTUAL BASE:
${contractContext}

WORK / SITE DOCUMENT:
--- Document ID: ${workDoc.id}
Title: ${workDoc.title}
Category: ${workDoc.category}
Chunk: ${workChunk.index + 1}/${workChunk.total}; source chars ${workChunk.start}-${workChunk.end} ---
${workChunk.text}

RELATED WORK / SITE DOCUMENTS FROM THE SAME PROJECT:
${relatedWorkContext || "No related work-document passage was found."}

IMPORTANT SCAN RULES:
1. Classify every finding as one of: סתירה, שינוי/חריג, אירוע שטח, חוסר נתונים, אין התאמה ישירה.
2. A true contradiction requires conflict between a contract/BOQ/spec instruction and actual work/site evidence.
3. Do not treat every site event as a contradiction. If it is only a field event, say so.
4. Evidence status can be VERIFIED only when both contract_quote and work_quote are real quotes from the provided context.
5. If one quote is missing, use REQUIRES_VERIFICATION and list exactly what is missing.
6. Never invent a clause, document, page, price, or confident conclusion without evidence.
7. If this chunk has no concrete finding, return an empty array. Create a Zero-Match finding only when the work text describes a specific obligation, cost, or instruction and no contract match was found.
8. Mention financial impact only as a practical direction unless a price appears in the documents.
9. Keep outputs businesslike and useful for a contractor, not technical noise.
10. Full-text coverage is active. This work document is processed in ${workChunk.total} chunk(s). All ${contractChunksIndexed} contract chunks (${contractSourceChars} source characters) were indexed; the most relevant chunks are shown above.
11. For every finding, state how document hierarchy was applied: contract source controls, documents complement each other, stricter requirement controls pending manager decision, manager/supervisor decision is required, or the work document is only supporting evidence.
12. Treat related work documents as a project timeline. A later dated document can resolve, replace, or narrow an earlier issue. Do not present an old issue as current when a later document says it was approved or completed.
13. If a later related document resolves the issue in the current work chunk, return an empty array. If it changes the issue, describe only the latest documented action and do not invent fault.
14. The complete readable work corpus was indexed in ${projectWorkChunksIndexed} chunks. The related passages above were selected from that full corpus.
15. Return at most one decisive finding for this chunk. Keep every text value short.

Return JSON array with this exact object shape:
[
  {
    "title": "כותרת קצרה בעברית",
    "description": "מה לא מסתדר ומה המשמעות לקבלן",
    "category": "סתירה / שינוי/חריג / אירוע שטח / חוסר נתונים / אין התאמה ישירה",
    "advice": "מה הקבלן צריך לבדוק או לעשות עכשיו",
    "contract_quote": "ציטוט מדויק מהחוזה/BOQ או null",
    "work_quote": "ציטוט מדויק ממסמך העבודה/שטח או null",
    "contract_document_id": "Document ID from contractual base or null",
    "work_document_id": "${workDoc.id}",
    "comparison_type": "contract_vs_execution / boq_vs_execution / specs_vs_execution / zero_match / missing_data / site_event",
    "document_hierarchy_rule": "contract_source_controls / documents_complement_each_other / stricter_requirement_controls / manager_decision_required / work_document_is_supporting_evidence",
    "risk_reason": "למה זה חשוב לקבלן",
    "confidence": 0.0,
    "next_check": "בדיקה מעשית הבאה"
  }
]`;
}

function getRelatedWorkMemory(
    workDoc: ScanDocument,
    projectWorkChunks: DocumentScanChunk[],
    projectWorkDocumentsById: Map<string, ScanDocument>,
) {
    const workChunks = buildDocumentScanChunks(
        [workDoc],
        WORK_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const relatedWorkChunksByIndex = new Map<number, DocumentScanChunk[]>();
    const relatedWorkDocumentIds = new Set<string>();

    for (const workChunk of workChunks) {
        const relatedChunks = selectRelevantProjectChunks(
            projectWorkChunks,
            workChunk.text,
            MAX_RELATED_WORK_CHARS,
            MAX_RELATED_WORK_CHUNKS,
            workDoc.id,
        );
        relatedWorkChunksByIndex.set(workChunk.index, relatedChunks);
        for (const relatedChunk of relatedChunks) {
            relatedWorkDocumentIds.add(relatedChunk.documentId);
        }
    }

    const relatedWorkDocuments = [...relatedWorkDocumentIds]
        .map((documentId) => projectWorkDocumentsById.get(documentId))
        .filter((document): document is ScanDocument => Boolean(document));

    return {
        workChunks,
        relatedWorkChunksByIndex,
        relatedWorkDocumentIds,
        relatedWorkSignature: buildDocumentSetFingerprint(relatedWorkDocuments),
    };
}

async function initializeExistingScanMemory(
    supabase: SupabaseClient,
    projectId: string,
    contractDocs: ScanDocument[],
    projectWorkDocs: ScanDocument[],
) {
    const baselineSignature = `memory-baseline:v1:${projectId}`;
    const { data: existingBaseline, error: baselineReadError } = await supabase
        .from("document_scan_state")
        .select("scan_signature, scanned_at")
        .eq("scan_signature", baselineSignature)
        .maybeSingle();

    if (baselineReadError) throw baselineReadError;

    const { data: legacyFindings, error: findingsError } = await supabase
        .from("contradictions")
        .select("id, source_execution_doc_id, title, description, strategy_advice")
        .eq("project_id", projectId)
        .neq("status", "ARCHIVED");

    if (findingsError) throw findingsError;
    if (!legacyFindings?.length) return null;

    const invalidFindingIds = legacyFindings
        .filter((finding) => isTemplatePlaceholderFinding({
            title: finding.title,
            description: finding.description,
            advice: finding.strategy_advice,
        }))
        .map((finding) => String(finding.id));
    const validLegacyFindings = legacyFindings.filter(
        (finding) => !invalidFindingIds.includes(String(finding.id)),
    );

    if (invalidFindingIds.length > 0) {
        const { error: archiveInvalidError } = await supabase
            .from("contradictions")
            .update({ status: "ARCHIVED" })
            .in("id", invalidFindingIds);
        if (archiveInvalidError) throw archiveInvalidError;
    }

    const completedAt = existingBaseline?.scanned_at || nowIso();
    const baselineCutoff = new Date(completedAt).getTime();
    const baselineWorkDocs = projectWorkDocs
        .filter((doc) => {
            const createdAt = new Date(String(doc.created_at || "")).getTime();
            return !Number.isFinite(createdAt) || createdAt <= baselineCutoff;
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    const readableWorkDocs = baselineWorkDocs
        .filter((doc) => hasUsefulText(doc))
        .sort((left, right) => left.id.localeCompare(right.id));
    if (baselineWorkDocs.length === 0) return null;

    const aiIdentity = getComparisonAiIdentity();
    const aiSignature = `${aiIdentity.provider}:${aiIdentity.model}`;
    const contractSignature = buildContractSignature(contractDocs);
    const contractDocIds = contractDocs.map((doc) => String(doc.id)).sort();
    const projectWorkChunks = buildDocumentScanChunks(
        readableWorkDocs,
        WORK_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const projectWorkDocumentsById = new Map(readableWorkDocs.map((doc) => [doc.id, doc]));
    const findingsByWorkDocId = new Map<string, string[]>();

    for (const finding of validLegacyFindings) {
        const workDocumentId = String(finding.source_execution_doc_id || "");
        if (!workDocumentId) continue;
        const ids = findingsByWorkDocId.get(workDocumentId) || [];
        ids.push(String(finding.id));
        findingsByWorkDocId.set(workDocumentId, ids);
    }

    const scanStates: DocumentScanStateRow[] = [];

    for (const [index, workDoc] of baselineWorkDocs.entries()) {
        const { relatedWorkSignature } = getRelatedWorkMemory(
            workDoc,
            projectWorkChunks,
            projectWorkDocumentsById,
        );
        const workSignature = getDocumentSignature(workDoc);
        const scanSignature = buildScanSignature(
            projectId,
            contractSignature,
            relatedWorkSignature,
            workSignature,
            aiSignature,
        );
        const findingIds = findingsByWorkDocId.get(workDoc.id) || [];

        if (findingIds.length > 0) {
            const { error: findingUpdateError } = await supabase
                .from("contradictions")
                .update({ scan_signature: scanSignature })
                .in("id", findingIds);
            if (findingUpdateError) throw findingUpdateError;
        }

        scanStates.push({
            project_id: projectId,
            contract_doc_ids: contractDocIds,
            work_doc_id: workDoc.id,
            contract_signature: contractSignature,
            work_signature: workSignature,
            scan_signature: scanSignature,
            status: "COMPLETED",
            findings_count: findingIds.length,
            processed_work_docs: index + 1,
            total_work_docs: baselineWorkDocs.length,
            current_step: `הזיכרון נשמר: ${workDoc.title || "מסמך ביצוע"}`,
            error_message: null,
            scanned_at: completedAt,
            updated_at: completedAt,
            completed_at: completedAt,
        });
    }

    const { error: stateWriteError } = await supabase
        .from("document_scan_state")
        .upsert(scanStates, { onConflict: "scan_signature" });
    if (stateWriteError) throw stateWriteError;

    await saveScanState(supabase, {
        project_id: projectId,
        contract_doc_ids: contractDocIds,
        work_doc_id: contractDocs[0]?.id || readableWorkDocs[0].id,
        contract_signature: contractSignature,
        work_signature: "existing-project-baseline",
        scan_signature: baselineSignature,
        status: "COMPLETED",
        findings_count: 0,
        processed_work_docs: baselineWorkDocs.length,
        total_work_docs: baselineWorkDocs.length,
        current_step: "MEMORY_BASELINE_INITIALIZED",
        error_message: null,
        scanned_at: completedAt,
        updated_at: completedAt,
        completed_at: completedAt,
    });

    return {
        findings: validLegacyFindings.length,
        unchanged: baselineWorkDocs.length,
        total: baselineWorkDocs.length,
        initialized: !existingBaseline,
    };
}

async function hasCompletedScanMemory(
    supabase: SupabaseClient,
    projectId: string,
    contractDocs: ScanDocument[],
    workDoc: ScanDocument,
    projectWorkDocs: ScanDocument[],
) {
    const readableProjectWorkDocs = projectWorkDocs.filter((doc) => hasUsefulText(doc));
    const projectWorkChunks = buildDocumentScanChunks(
        readableProjectWorkDocs,
        WORK_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const documentsById = new Map(readableProjectWorkDocs.map((doc) => [doc.id, doc]));
    const { relatedWorkSignature } = getRelatedWorkMemory(workDoc, projectWorkChunks, documentsById);
    const aiIdentity = getComparisonAiIdentity();
    const scanSignature = buildScanSignature(
        projectId,
        buildContractSignature(contractDocs),
        relatedWorkSignature,
        getDocumentSignature(workDoc),
        `${aiIdentity.provider}:${aiIdentity.model}`,
    );
    const { data, error } = await supabase
        .from("document_scan_state")
        .select("status")
        .eq("scan_signature", scanSignature)
        .maybeSingle();
    if (error) throw error;
    return data?.status === "COMPLETED";
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
        const batchCursor = Number.isInteger(body.batchCursor) && body.batchCursor >= 0
            ? Number(body.batchCursor)
            : null;

        if (!projectId) {
            return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        }

        const supabase = await createClient();
        const ownership = await requireOwnedProject(supabase, projectId);

        if (!ownership.ok) {
            return ownership.response;
        }

        await archiveTemplatePlaceholderFindings(supabase, projectId);

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
            await supabase.from("document_scan_state").delete().eq("project_id", projectId);
        } else if (workDocId) {
            await supabase.from("document_scan_state").delete().eq("project_id", projectId).eq("work_doc_id", workDocId);
        }

        const { data: documentRows } = await supabase.from("documents").select("*").eq("project_id", projectId);
        const documents = (documentRows || []) as ScanDocument[];
        if (documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        const documentsWithoutManualConfirmation = documents.filter((doc) => doc.ai_status !== "VALIDATED").length;
        let documentsWithRoles: ScanDocumentWithRole[] = documents.map((doc): ScanDocumentWithRole => ({
            ...doc,
            __scanRole: getDocumentRole(doc),
        }));
        let contractDocs = documentsWithRoles.filter((d) => d.__scanRole === "CONTRACT_BASE");
        let allWorkDocs = documentsWithRoles
            .filter((d) => d.__scanRole === "WORK_EVIDENCE")
            .sort((left, right) => left.id.localeCompare(right.id));
        let workDocs = allWorkDocs;

        if (workDocId) {
            workDocs = workDocs.filter((d) => d.id === workDocId);
        } else if (batchCursor !== null) {
            workDocs = workDocs.slice(batchCursor, batchCursor + 1);
        }

        if (contractDocs.length === 0) {
            return NextResponse.json({
                success: false,
                error: "לא נמצאו מסמכי בסיס להשוואה. יש להעלות או לסווג חוזה, כתב כמויות, מפרט או מכרז לפני סריקת סתירות."
            }, { status: 400 });
        }

        if (workDocs.length === 0 && batchCursor !== null && batchCursor >= allWorkDocs.length) {
            return NextResponse.json({
                success: true,
                found: 0,
                memory: { scanned: 0, unchanged: 0, total: 0 },
                continuation: {
                    done: true,
                    nextCursor: allWorkDocs.length,
                    processed: allWorkDocs.length,
                    total: allWorkDocs.length,
                },
            });
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
            allWorkDocs = documentsWithRoles
                .filter((d) => d.__scanRole === "WORK_EVIDENCE")
                .sort((left, right) => left.id.localeCompare(right.id));
            workDocs = allWorkDocs;

            if (workDocId) {
                workDocs = workDocs.filter((d) => d.id === workDocId);
            } else if (batchCursor !== null) {
                workDocs = workDocs.slice(batchCursor, batchCursor + 1);
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

        if (!workDocId && batchCursor === 0) {
            const initializedMemory = await initializeExistingScanMemory(
                supabase,
                projectId,
                contractDocs,
                allWorkDocs,
            );

            if (initializedMemory?.initialized) {
                return NextResponse.json({
                    success: true,
                    found: initializedMemory.findings,
                    memory: {
                        scanned: 0,
                        unchanged: initializedMemory.unchanged,
                        total: initializedMemory.total,
                    },
                    continuation: {
                        done: true,
                        nextCursor: initializedMemory.total,
                        processed: initializedMemory.total,
                        total: initializedMemory.total,
                    },
                    baselineInitialized: true,
                });
            }
        }

        if (!workDocs.some((doc) => hasUsefulText(doc)) && batchCursor !== null) {
            const nextCursor = Math.min(batchCursor + 1, allWorkDocs.length);
            const unchanged = workDocs[0]
                ? await hasCompletedScanMemory(supabase, projectId, contractDocs, workDocs[0], allWorkDocs)
                : false;

            if (unchanged) {
                return NextResponse.json({
                    success: true,
                    found: 0,
                    memory: { scanned: 0, unchanged: 1, total: 1 },
                    continuation: {
                        done: nextCursor >= allWorkDocs.length,
                        nextCursor,
                        processed: nextCursor,
                        total: allWorkDocs.length,
                    },
                });
            }

            return NextResponse.json({
                success: false,
                partial: true,
                found: 0,
                warnings: ["The document could not be read and was skipped."],
                memory: { scanned: 0, unchanged: 0, total: 1 },
                continuation: {
                    done: nextCursor >= allWorkDocs.length,
                    nextCursor,
                    processed: nextCursor,
                    total: allWorkDocs.length,
                },
            });
        }

        if (!workDocs.some((doc) => hasUsefulText(doc))) {
            return NextResponse.json({
                success: false,
                error: "Execution documents exist, but no readable text could be extracted for comparison. Open the execution documents page and run document scan on at least one execution PDF."
            }, { status: 400 });
        }

        const readableProjectWorkDocs = allWorkDocs.filter((doc) => hasUsefulText(doc));
        const foundContradictions = await analyzeDirectly(
            supabase,
            projectId,
            contractDocs,
            workDocs,
            readableProjectWorkDocs,
            force,
            batchCursor === null ? undefined : {
                offset: batchCursor,
                total: allWorkDocs.length,
            },
        );
        const analysisFailures = foundContradictions.__analysisFailures || [];
        const warnings = [...textPreparationFailures, ...analysisFailures];
        const scanStatus = await loadProjectScanState(supabase, projectId, workDocId);
        const memory = {
            scanned: foundContradictions.__scannedDocuments || 0,
            unchanged: foundContradictions.__cachedDocuments || 0,
            total: workDocs.filter((doc) => hasUsefulText(doc)).length,
        };
        const nextCursor = batchCursor === null
            ? null
            : Math.min(batchCursor + 1, allWorkDocs.length);
        const continuation = nextCursor === null
            ? undefined
            : {
                done: nextCursor >= allWorkDocs.length,
                nextCursor,
                processed: nextCursor,
                total: allWorkDocs.length,
            };

        return NextResponse.json({
            success: warnings.length === 0,
            partial: warnings.length > 0,
            found: foundContradictions.length,
            contradictions: foundContradictions,
            cached: foundContradictions.length > 0 && foundContradictions.every((item) => item.__cached === true),
            documentsWithoutManualConfirmation,
            warnings,
            scanStatus,
            memory,
            continuation,
        });

    } catch (error: unknown) {
        console.error("[scan] API Error:", error);
        const message = error instanceof Error ? error.message : "Scan failed";
        return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
}

async function analyzeDirectly(
    supabase: SupabaseClient,
    projectId: string,
    contractDocs: ScanDocument[],
    workDocs: ScanDocument[],
    projectWorkDocs: ScanDocument[],
    force = false,
    batchProgress?: { offset: number; total: number },
): Promise<ScanResults> {
    const results: ScanResults = [] as ScanResults;
    const analysisFailures: string[] = [];
    let cachedDocumentCount = 0;
    let scannedDocumentCount = 0;
    const aiIdentity = getComparisonAiIdentity();
    const aiSignature = `${aiIdentity.provider}:${aiIdentity.model}`;
    const contractSignature = buildContractSignature(contractDocs);
    const contractDocIds = contractDocs.map((doc) => String(doc.id)).sort();
    const orderedContractDocs = sortContractDocumentsByPrecedence(contractDocs.filter(d => d.extracted_text));
    const contractChunks = buildDocumentScanChunks(
        orderedContractDocs,
        CONTRACT_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const contractSourceChars = orderedContractDocs.reduce(
        (sum, doc) => sum + String(doc.extracted_text || '').length,
        0,
    );
    const stableProjectWorkDocs = projectWorkDocs
        .filter((doc) => doc.extracted_text)
        .sort((left, right) => left.id.localeCompare(right.id));
    const projectWorkDocumentsById = new Map(stableProjectWorkDocs.map((doc) => [doc.id, doc]));
    const projectWorkChunks = buildDocumentScanChunks(
        stableProjectWorkDocs,
        WORK_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const projectWorkSourceChars = projectWorkDocs.reduce(
        (sum, doc) => sum + String(doc.extracted_text || "").length,
        0,
    );

    if (contractChunks.length === 0) {
        throw new Error("Contract documents exist, but no extracted text is available for comparison.");
    }

    const scannableWorkDocs = workDocs.filter((doc) => Boolean(doc.extracted_text));
    let processedWorkDocs = batchProgress?.offset || 0;
    const totalWorkDocs = batchProgress?.total || scannableWorkDocs.length;

    for (const workDoc of scannableWorkDocs) {
        const fullWorkText = String(workDoc.extracted_text || "");
        const {
            workChunks,
            relatedWorkChunksByIndex,
            relatedWorkDocumentIds,
            relatedWorkSignature,
        } = getRelatedWorkMemory(workDoc, projectWorkChunks, projectWorkDocumentsById);
        const workSignature = getDocumentSignature(workDoc);
        const scanSignature = buildScanSignature(
            projectId,
            contractSignature,
            relatedWorkSignature,
            workSignature,
            aiSignature,
        );
        const stateBase = {
            project_id: projectId,
            contract_doc_ids: contractDocIds,
            work_doc_id: workDoc.id,
            contract_signature: contractSignature,
            work_signature: workSignature,
            scan_signature: scanSignature,
            total_work_docs: totalWorkDocs,
        };

        try {
            let oldFindingsToArchive: ContradictionArchiveRow[] = [];

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
                        cachedDocumentCount += 1;
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
                        cachedDocumentCount += 1;
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

                const { data: oldFindings, error: oldFindingsError } = await supabase
                    .from("contradictions")
                    .select("id, evidence_data")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED")
                    .or(`scan_signature.is.null,scan_signature.neq.${scanSignature}`);

                if (oldFindingsError) throw oldFindingsError;
                oldFindingsToArchive = (oldFindings || []) as ContradictionArchiveRow[];
            } else {
                const { data: oldFindings, error: oldFindingsError } = await supabase
                    .from("contradictions")
                    .select("id, evidence_data")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED");

                if (oldFindingsError) throw oldFindingsError;
                oldFindingsToArchive = (oldFindings || []) as ContradictionArchiveRow[];
            }

            await saveScanState(supabase, {
                ...stateBase,
                status: "IN_PROGRESS",
                findings_count: 0,
                processed_work_docs: processedWorkDocs,
                current_step: `בודק ${processedWorkDocs + 1}/${totalWorkDocs}: ${workDoc.title || "מסמך ביצוע"}`,
                error_message: null,
                started_at: nowIso(),
                updated_at: nowIso(),
                completed_at: null,
            });

            const chunkFindings: ScanFinding[] = [];

            for (const workChunk of workChunks) {
                const selectedContractChunks = selectRelevantContractChunks(
                    contractChunks,
                    workChunk.text,
                    MAX_SELECTED_CONTRACT_CHARS,
                    MAX_SELECTED_CONTRACT_CHUNKS,
                );
                const contractContext = formatContractChunkContext(selectedContractChunks);
                const relatedWorkChunks = relatedWorkChunksByIndex.get(workChunk.index) || [];
                const relatedWorkContext = formatRelatedWorkTimeline(relatedWorkChunks, workChunk.text);
                const prompt = buildScanPrompt({
                    contractContext,
                    relatedWorkContext,
                    workDoc,
                    workChunk,
                    contractChunksIndexed: contractChunks.length,
                    contractSourceChars,
                    projectWorkChunksIndexed: projectWorkChunks.length,
                });

                await saveScanState(supabase, {
                    ...stateBase,
                    status: "IN_PROGRESS",
                    findings_count: 0,
                    processed_work_docs: processedWorkDocs,
                    current_step: `בודק ${processedWorkDocs + 1}/${totalWorkDocs}, חלק ${workChunk.index + 1}/${workChunk.total}: ${workDoc.title || "מסמך ביצוע"}`,
                    error_message: null,
                    started_at: nowIso(),
                    updated_at: nowIso(),
                    completed_at: null,
                });

                chunkFindings.push(...await withScanHeartbeat(
                    supabase,
                    scanSignature,
                    () => generateScanChunkFindings(prompt),
                ));
            }

            const points = dedupeScanFindings(chunkFindings)
                .filter((finding) => !isTemplatePlaceholderFinding(finding));
            const findingRows = points.map((p) => {
                const category = String(p.category || "");
                const matchedContractDoc = p.contract_document_id
                    ? contractDocs.find((doc) => doc.id === p.contract_document_id)
                    : null;
                const missingEvidence = Array.isArray(p.missing_evidence) ? [...p.missing_evidence] : [];
                const contractQuote = typeof p.contract_quote === 'string' ? p.contract_quote : '';
                const workQuote = typeof p.work_quote === 'string' ? p.work_quote : '';
                const contractQuoteMatched = Boolean(
                    matchedContractDoc
                    && quoteExistsInSource(String(matchedContractDoc.extracted_text || ''), contractQuote)
                );
                const workQuoteMatched = quoteExistsInSource(fullWorkText, workQuote);

                if (!matchedContractDoc) {
                    missingEvidence.push("contract_document_id was not matched to a project contract document");
                }
                if (matchedContractDoc && !contractQuoteMatched) {
                    missingEvidence.push("contract_quote was not matched exactly to the contract source text");
                }
                if (!workQuoteMatched) {
                    missingEvidence.push("work_quote was not matched exactly to the work source text");
                }

                return {
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
                        evidence_status: matchedContractDoc
                            ? normalizeEvidenceStatus(p, contractQuoteMatched, workQuoteMatched)
                            : "REQUIRES_VERIFICATION",
                        missing_evidence: [...new Set(missingEvidence)],
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
                            scan_engine: SCAN_ENGINE_VERSION,
                            contract_source_chars_indexed: contractSourceChars,
                            contract_chunks_indexed: contractChunks.length,
                            contract_chunks_selected_per_work_chunk: MAX_SELECTED_CONTRACT_CHUNKS,
                            contract_context_truncated: false,
                            work_chars_used: fullWorkText.length,
                            work_chunks_processed: workChunks.length,
                            work_context_truncated: false,
                            project_work_source_chars_indexed: projectWorkSourceChars,
                            project_work_chunks_indexed: projectWorkChunks.length,
                            related_work_chunks_selected_per_work_chunk: MAX_RELATED_WORK_CHUNKS,
                            related_work_document_ids: [...relatedWorkDocumentIds].sort(),
                            related_work_signature: relatedWorkSignature,
                            project_timeline_context_enabled: true,
                        },
                        source_verification: {
                            contract_quote_matched: contractQuoteMatched,
                            work_quote_matched: workQuoteMatched,
                        },
                        expert_strategy: p.expert_strategy || {},
                        analysis_provider: aiIdentity.provider,
                        analysis_model: aiIdentity.model,
                    }
                };
            });

            let insertedResults: ScanResult[] = [];
            if (findingRows.length > 0) {
                const { data, error } = await supabase
                    .from("contradictions")
                    .insert(findingRows)
                    .select();

                if (error) {
                    throw new Error(`Failed to save scan findings for "${workDoc.title}": ${error.message}`);
                }

                insertedResults = (data || []) as ScanResult[];
            }

            if (oldFindingsToArchive.length > 0) {
                await archiveContradictionRows(
                    supabase,
                    oldFindingsToArchive,
                    {
                        archive_reason: "A complete replacement scan finished successfully for this work document.",
                        archived_at: new Date().toISOString(),
                        current_scan_signature: scanSignature,
                    }
                );
            }
            results.push(...insertedResults);
            scannedDocumentCount += 1;

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
    results.__cachedDocuments = cachedDocumentCount;
    results.__scannedDocuments = scannedDocumentCount;
    return results;
}
