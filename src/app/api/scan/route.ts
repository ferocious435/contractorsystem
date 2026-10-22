import { NextRequest, NextResponse } from "next/server";
import { requireOwnedProject } from "@/app/api/_utils/auth";
import {
    CONTRACT_DOCUMENT_HIERARCHY_GUIDE,
    isProjectContractBaseDocument,
    isReferenceDocument,
    sortContractDocumentsByPrecedence,
} from "@/utils/contract-document-hierarchy";
import { downloadDocumentBuffer } from "@/utils/document-storage";
import {
    buildDocumentScanChunks,
    prepareContractComparisonContext,
    formatRelatedWorkTimeline,
    hasUsefulDocumentScanText,
    normalizeDocumentTextForScan,
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
import { removePreferredPdfDuplicates, type DuplicateCleanupResult } from "@/utils/document-duplicate-cleanup";
import { findExactContentHashDuplicates, findPreferredPdfDuplicates } from "@/utils/document-duplicates";
import { prepareDocumentAnalysisInput } from "@/utils/document-text-extraction";
import { parseScanFindings } from "@/utils/scan-ai-response";
import { buildScanRetryQueue } from "@/utils/scan-retry-queue";
import {
    assessContractScanFinding,
    assertGeneratedScanSources,
    buildContractScanPrompt,
    buildGroundedScanResponseSchema,
    CONTRACT_SCAN_INSTRUCTION_VERSION,
    CONTRACT_SCAN_MEMORY_VERSION,
    CONTRACT_SCAN_QUALITY_VERSION,
    CONTRACT_SCAN_RESPONSE_SCHEMA,
    findingHasActionableWorkEvidence,
    findingIsSupersededByLaterEvidence,
    groundContractScanFinding,
    isTemplatePlaceholderFinding,
    sourceVerificationMissingEvidence,
} from "@/utils/contract-scan-quality";
import { generateComparisonText, getComparisonAiIdentity } from "@/lib/comparison-ai";
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';
import { createClient } from "@/utils/supabase/server";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichProjectFindingsWithSupportSources } from "@/utils/support-source-enrichment-server";
import {
    consolidateRepeatedAutomaticFindings,
    deleteObsoleteAutomaticArchiveRows,
    deleteUnsupportedAutomaticFindings,
    replacePreviousScanFindings,
    type ReplaceableScanFinding,
} from "@/utils/scan-finding-retention";
import { loadProjectBoundReferenceDocuments } from "@/utils/document-reference-authority-server";
import { buildReferenceAwareContractSignature, contractSourcePointers, selectBoundReferenceDocuments,
    type BoundReferenceDocument } from "@/utils/bound-reference-comparison";

export const maxDuration = 600;
const CONTRACT_CHUNK_CHARS = 2_500;
const WORK_CHUNK_CHARS = 7_000;
const CHUNK_OVERLAP_CHARS = 400;
const MAX_SELECTED_CONTRACT_CHARS = 2_500;
const MAX_SELECTED_CONTRACT_CHUNKS = 1;
const MAX_RELATED_WORK_CHARS = 2_100;
const MAX_RELATED_WORK_CHUNKS = 3;
const SCAN_ENGINE_VERSION = CONTRACT_SCAN_MEMORY_VERSION;
const CONTRACT_ROLES = new Set(["CONTRACT", "BOQ", "SPECS", "TENDER"]);
const WORK_ROLES = new Set(["EXECUTION", "SITE_REPORT", "PROTOCOL", "INVOICE", "CHANGE_ORDER", "PHOTO", "VIDEO", "LETTER"]);
const SCAN_CONTRACT_HIERARCHY_GUIDE = CONTRACT_DOCUMENT_HIERARCHY_GUIDE
    .split("\n")
    .filter((line) => /First follow|Project contract documents|Shelf contracts|Execution documents|If contract documents conflict|For variations/.test(line))
    .join("\n");
const ACTIVE_SCAN_STALE_MS = 45_000;
const SCAN_HEARTBEAT_MS = 15_000;
const BACKGROUND_SCAN_RETRY_MS = 3_000;
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
type ScanStateStatus = "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "ERROR";

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
    reference_authority?: BoundReferenceDocument['reference_authority'];
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

type BackgroundScanStepResponse = {
    success?: boolean;
    partial?: boolean;
    active?: boolean;
    error?: string;
    message?: string;
    continuation?: {
        done: boolean;
        nextCursor: number;
        processed: number;
        total: number;
    };
};

type RetryProgress = {
    active: boolean; status: string; progress: number; processed: number; total: number;
    currentStep: string; skipped: number; excluded: number; failed: number; found: number;
    errorMessage?: string | null; completedAt?: string | null; updatedAt?: string;
};

const EMPTY_DUPLICATE_CLEANUP: DuplicateCleanupResult = {
    removedDocuments: 0,
    removedAutomaticFindings: 0,
    preservedUserFindings: 0,
    storageWarnings: [],
};

const scanJobGlobal = globalThis as typeof globalThis & {
    __contractorSystemScanJobs?: Map<string, Promise<void>>;
    __contractorSystemRetryProgress?: Map<string, RetryProgress>;
};
const backgroundScanJobs = scanJobGlobal.__contractorSystemScanJobs
    || (scanJobGlobal.__contractorSystemScanJobs = new Map<string, Promise<void>>());
const retryProgressByProject = scanJobGlobal.__contractorSystemRetryProgress
    || (scanJobGlobal.__contractorSystemRetryProgress = new Map<string, RetryProgress>());

async function generateScanChunkFindings(prompt: string, validate?: (findings: ScanFinding[]) => void,
    responseSchema: Record<string, unknown> = CONTRACT_SCAN_RESPONSE_SCHEMA) {
    const attempts = [
        { numPredict: 1_024, timeoutMs: 180_000, retryInstruction: "" },
        {
            numPredict: 1_536,
            timeoutMs: 240_000,
            retryInstruction: "\nRETRY: Return only the single most decisive finding, with very short values and valid JSON.",
        },
    ];
    let lastError: unknown = new Error("Local AI did not return a valid scan result");

    for (const attempt of attempts) {
        const startedAt = Date.now();
        try {
            const responseText = await generateComparisonText(
                `${prompt}${attempt.retryInstruction}`,
                process.env,
                {
                    numCtx: 8_192,
                    numPredict: attempt.numPredict,
                    timeoutMs: attempt.timeoutMs,
                    responseFormat: responseSchema,
                    temperature: 0,
                    seed: 42,
                },
            );
            console.info(`[scan] Ollama completed ${prompt.length} prompt characters in ${Math.round((Date.now() - startedAt) / 1000)}s`);
            const findings = parseScanFindings(responseText, { requireSemantic: true }) as ScanFinding[];
            validate?.(findings);
            return findings;
        } catch (error) {
            console.warn(`[scan] Ollama attempt failed after ${Math.round((Date.now() - startedAt) / 1000)}s`);
            lastError = error;
        }
    }

    throw lastError;
}

function sha256Buffer(input: Buffer) {
    return createHash("sha256").update(input).digest("hex");
}

function hasUsefulText(doc: ScanDocument) {
    return hasUsefulDocumentScanText(doc);
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
    const latestRowsByDocument = new Map<string, DocumentScanStateRow>();
    for (const row of rows) {
        if (!latestRowsByDocument.has(row.work_doc_id)) {
            latestRowsByDocument.set(row.work_doc_id, row);
        }
    }
    const currentRows = [...latestRowsByDocument.values()];
    const activeRow = currentRows.find(isFreshInProgressScan);
    const latestRow = activeRow || currentRows[0] || null;
    const explicitTotal = Math.max(
        latestRow?.total_work_docs || 0,
        ...currentRows.map((row) => row.total_work_docs || 0)
    );
    const relevantRows = explicitTotal > 0
        ? currentRows.filter((row) => row.total_work_docs === explicitTotal || row.status === "IN_PROGRESS")
        : currentRows;
    const total = explicitTotal || relevantRows.length;
    const processedFallback = relevantRows.filter(
        (row) => row.status === "COMPLETED" || row.status === "SKIPPED" || row.status === "ERROR"
    );
    const processed = Math.min(
        total,
        Math.max(
            latestRow?.processed_work_docs || 0,
            processedFallback.length
        )
    );
    const staleInProgressRow = currentRows.find((row) => row.status === "IN_PROGRESS" && !isFreshInProgressScan(row));
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
        skipped: relevantRows.filter((row) => row.status === "SKIPPED"
            && !/^DOCUMENT_SOURCE_(?:DRAFT|FRAGMENT)$/u.test(row.error_message || '')).length,
        excluded: relevantRows.filter((row) => row.status === "SKIPPED"
            && /^DOCUMENT_SOURCE_(?:DRAFT|FRAGMENT)$/u.test(row.error_message || '')).length,
        failed: relevantRows.filter((row) => row.status === "ERROR").length,
    };
}

async function deleteSupersededScanStates(
    supabase: SupabaseClient,
    projectId: string,
    workDocId: string,
    currentScanSignature: string,
) {
    const { error } = await supabase
        .from("document_scan_state")
        .delete()
        .eq("project_id", projectId)
        .eq("work_doc_id", workDocId)
        .neq("scan_signature", currentScanSignature);
    if (error) throw error;
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

function waitForBackgroundScanRetry() {
    return new Promise((resolve) => setTimeout(resolve, BACKGROUND_SCAN_RETRY_MS));
}

function createBackgroundScanRequest(
    sourceRequest: NextRequest,
    body: Record<string, unknown>,
) {
    const headers = new Headers(sourceRequest.headers);
    headers.set("content-type", "application/json");
    headers.delete("content-length");

    return new NextRequest(sourceRequest.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}

async function runProjectScanInBackground(
    sourceRequest: NextRequest,
    projectId: string,
    force: boolean,
    retryQueue?: Array<{ id: string; cursor: number }>,
) {
    let cursor = 0;
    let firstRequest = true;

    let retryIndex = 0;
    while (true) {
        const retryItem = retryQueue?.[retryIndex];
        const retryProgress = retryProgressByProject.get(projectId);
        if (retryItem && retryProgress) {
            retryProgress.currentStep = `בדיקה חוזרת ${retryIndex + 1}/${retryQueue!.length}: קריאה והשוואת המסמך`;
        }
        const response = await POST(createBackgroundScanRequest(sourceRequest, {
            projectId,
            force: firstRequest ? force : false,
            batchCursor: retryItem?.cursor ?? cursor,
            retryDocumentId: retryItem?.id,
        }));
        const data = await response.json() as BackgroundScanStepResponse;
        firstRequest = false;

        if (data.active && !data.continuation) {
            await waitForBackgroundScanRetry();
            continue;
        }

        if (!data.success && !data.partial) {
            throw new Error(data.error || data.message || `Scan stopped at document ${cursor + 1}`);
        }

        if (!data.continuation) {
            throw new Error(`Scan response did not include progress at document ${cursor + 1}`);
        }

        if (retryItem && retryProgress) {
            const supabase = await createClient();
            const { data: state, error } = await supabase.from("document_scan_state")
                .select("status,findings_count,current_step,error_message")
                .eq("project_id", projectId).eq("work_doc_id", retryItem.id)
                .order("updated_at", { ascending: false }).limit(1).maybeSingle();
            if (error) throw error;
            retryProgress.processed = retryIndex + 1;
            retryProgress.progress = Math.round((retryIndex + 1) / retryQueue!.length * 100);
            const excluded = state?.status === "SKIPPED" && /DOCUMENT_SOURCE_(?:DRAFT|FRAGMENT)/.test(String(state?.error_message || ''));
            retryProgress.skipped += state?.status === "SKIPPED" && !excluded ? 1 : 0;
            retryProgress.excluded += excluded ? 1 : 0;
            retryProgress.failed += state?.status === "ERROR" ? 1 : 0;
            retryProgress.found += state?.findings_count || 0;
            retryProgress.currentStep = `בדיקה חוזרת ${retryIndex + 1}/${retryQueue!.length}: ${state?.current_step || "הטיפול הושלם"}`;
            retryProgress.updatedAt = nowIso();
            retryIndex += 1;
        }
        if (retryQueue ? retryIndex >= retryQueue.length : data.continuation.done) {
            const supabase = await createClient();
            const deletedUnsupportedFindings = await deleteUnsupportedAutomaticFindings(supabase, projectId);
            const repeatedFindings = await consolidateRepeatedAutomaticFindings(supabase, projectId);
            const enrichment = await enrichProjectFindingsWithSupportSources({
                supabase,
                projectId,
                onProgress: async ({ processed, total, failed, currentTitle }) => {
                    if (retryProgress) {
                        retryProgress.currentStep = `בודק מקורות ${processed}/${total}: ${currentTitle}`;
                        retryProgress.updatedAt = nowIso();
                    }
                    const { data: latestState } = await supabase
                        .from("document_scan_state")
                        .select("id")
                        .eq("project_id", projectId)
                        .order("updated_at", { ascending: false })
                        .limit(1)
                        .maybeSingle();
                    if (!latestState?.id) return;
                    await supabase
                        .from("document_scan_state")
                        .update({
                            current_step: `בודק השפעה ומקורות ${processed}/${total}: ${currentTitle}${failed > 0 ? ` · שגיאות: ${failed}` : ""}`,
                            updated_at: nowIso(),
                        })
                        .eq("id", latestState.id);
                },
            });
            const deletedObsoleteArchiveRows = await deleteObsoleteAutomaticArchiveRows(supabase, projectId);
            console.info("[scan:support] Project support analysis completed:", {
                ...enrichment,
                deletedUnsupportedFindings,
                repeatedFindings,
                deletedObsoleteArchiveRows,
            });
            if (retryProgress) {
                retryProgress.active = false;
                retryProgress.status = retryProgress.failed > 0 ? "ERROR" : "COMPLETED";
                retryProgress.completedAt = nowIso();
            }
            return;
        }
        cursor = data.continuation.nextCursor;
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

async function extractTextForScan<T extends ScanDocument>(supabase: SupabaseClient, doc: T): Promise<T> {
    const pdfBuffer = await downloadDocumentBuffer(supabase, doc);
    const contentHash = sha256Buffer(pdfBuffer);

    const prepared = await prepareDocumentAnalysisInput(pdfBuffer, doc.title || "document.pdf");
    if (prepared.kind !== "text") {
        throw new Error(`Document "${doc.title}" still has no readable text after local extraction`);
    }

    const extractedText = prepared.extractedText;
    const extractedTextHash = hashScanValue(extractedText);
    const parsedJson = { ...doc.parsed_json, ...(prepared.readingVerification
        ? { source_reading: prepared.readingVerification } : {}) };
    const hasReadableText = assessDocumentSourceReadiness({ ...doc, extracted_text: extractedText,
        parsed_json: parsedJson, ocr_status: "COMPLETED" }).extractionComplete;
    const requiresReview = Boolean(prepared.requiresReview) || !hasReadableText;

    const { error } = await supabase
        .from("documents")
        .update({
            extracted_text: extractedText,
            ocr_status: requiresReview ? "REQUIRES_REVIEW" : "COMPLETED",
            parsed_json: parsedJson,
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
        ocr_status: requiresReview ? "REQUIRES_REVIEW" : "COMPLETED",
        parsed_json: parsedJson,
        content_hash: contentHash,
        extracted_text_hash: extractedTextHash,
        processed_at: new Date().toISOString()
    } as T;
}

async function ensureScanTextForDocuments<T extends ScanDocument>(supabase: SupabaseClient, documents: T[]) {
    const prepared: T[] = [];
    const failures: string[] = [];

    for (const doc of documents) {
        if (assessDocumentSourceReadiness(doc).extractionComplete) {
            prepared.push(doc);
            continue;
        }

        try {
            prepared.push(await extractTextForScan(supabase, doc));
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

async function deleteTemplatePlaceholderFindings(supabase: SupabaseClient, projectId: string) {
    const { data: candidates, error: candidateError } = await supabase
        .from("contradictions")
        .select("id, title, description, strategy_advice, scan_signature")
        .eq("project_id", projectId);
    if (candidateError) throw candidateError;

    const invalidFindings = (candidates || []).filter((finding) => isTemplatePlaceholderFinding({
        title: finding.title,
        description: finding.description,
        advice: finding.strategy_advice,
    }));
    if (invalidFindings.length === 0) return 0;

    const { error: deleteError } = await supabase
        .from("contradictions")
        .delete()
        .in("id", invalidFindings.map((finding) => String(finding.id)));
    if (deleteError) throw deleteError;

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

function comparisonTypeForCategory(category: string) {
    if (category === "פעולה לביצוע") return "project_timeline_action";
    if (category === "אירוע שטח") return "site_event";
    if (category === "חוסר נתונים") return "missing_data";
    if (category === "אין התאמה ישירה") return "zero_match";
    return "contract_vs_execution";
}

async function resetPrematureScanBaseline(supabase: SupabaseClient, projectId: string) {
    const baselineSignature = `memory-baseline:v1:${projectId}`;
    const { data: existingBaseline, error: baselineReadError } = await supabase
        .from("document_scan_state")
        .select("scan_signature")
        .eq("scan_signature", baselineSignature)
        .maybeSingle();
    if (baselineReadError) throw baselineReadError;
    if (!existingBaseline) return false;

    const { error: stateDeleteError } = await supabase
        .from("document_scan_state")
        .delete()
        .eq("project_id", projectId);
    if (stateDeleteError) throw stateDeleteError;

    const { error: findingResetError } = await supabase
        .from("contradictions")
        .update({ scan_signature: null })
        .eq("project_id", projectId)
        .neq("status", "ARCHIVED");
    if (findingResetError) throw findingResetError;

    return true;
}

async function getDocumentScanMemoryState(
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
    const contractSignature = buildContractSignature(contractDocs);
    const workSignature = getDocumentSignature(workDoc);
    const contractDocIds = contractDocs.map((doc) => String(doc.id)).sort();
    const { data, error } = await supabase
        .from("document_scan_state")
        .select("status")
        .eq("scan_signature", scanSignature)
        .maybeSingle();
    if (error) throw error;
    return {
        status: data?.status || null,
        scanSignature,
        contractSignature,
        workSignature,
        contractDocIds,
    };
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

        const backgroundActive = backgroundScanJobs.has(projectId);

        return NextResponse.json({
            success: true,
            ...scanStatus,
            ...(!workDocId ? retryProgressByProject.get(projectId) : undefined),
            active: backgroundActive || (retryProgressByProject.has(projectId) && !workDocId
                ? retryProgressByProject.get(projectId)!.active : scanStatus.active),
            status: backgroundActive ? "IN_PROGRESS" : (!workDocId ? retryProgressByProject.get(projectId)?.status : undefined) || scanStatus.status,
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
        const { projectId, force = false, workDocId = null, background = false, retrySkipped = false } = body;
        const retryDocumentId = typeof body.retryDocumentId === "string" ? body.retryDocumentId : null;
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

        if (body.revalidateSavedOnly === true) {
            if (background || force || retrySkipped || backgroundScanJobs.has(projectId)) {
                return NextResponse.json({ success: false, error: 'Saved-evidence review cannot run together with scanning' }, { status: 409 });
            }
            const excluded = await deleteUnsupportedAutomaticFindings(supabase, projectId, { reviewOnly: true });
            return NextResponse.json({ success: true, excluded, scanned: 0,
                message: `בדיקת הממצאים השמורים הושלמה. ${excluded} השוואות שגויות הוצאו מהתצוגה.` });
        }

        if (background && !workDocId) {
            const existingJob = backgroundScanJobs.get(projectId);
            if (!existingJob) {
                let retryQueue: Array<{ id: string; cursor: number }> | undefined;
                retryProgressByProject.delete(projectId);
                if (retrySkipped) {
                    const [documentResult, stateResult] = await Promise.all([
                        supabase.from("documents").select("*").eq("project_id", projectId),
                        supabase.from("document_scan_state").select("work_doc_id,status,updated_at").eq("project_id", projectId),
                    ]);
                    if (documentResult.error) throw documentResult.error;
                    if (stateResult.error) throw stateResult.error;
                    const workDocuments = (documentResult.data || [] as ScanDocument[])
                        .filter((doc) => getDocumentRole(doc) === "WORK_EVIDENCE")
                        .sort((left, right) => left.id.localeCompare(right.id));
                    retryQueue = buildScanRetryQueue(workDocuments, stateResult.data || []);
                    if (retryQueue.length === 0) {
                        return NextResponse.json({ success: true, scanStatus: await loadProjectScanState(supabase, projectId), message: "אין מסמכים שדורשים ניסיון חוזר" });
                    }
                    retryProgressByProject.set(projectId, { active: true, status: "IN_PROGRESS", progress: 0,
                        processed: 0, total: retryQueue.length, currentStep: `מתחיל בדיקה חוזרת של ${retryQueue.length} מסמכים`,
                        skipped: 0, excluded: 0, failed: 0, found: 0, completedAt: null, errorMessage: null, updatedAt: nowIso() });
                }
                const job = runProjectScanInBackground(req, projectId, retrySkipped ? false : Boolean(force), retryQueue)
                    .catch((error) => {
                        console.error(`[scan] Background project scan failed for ${projectId}:`, error);
                        const progress = retryProgressByProject.get(projectId);
                        if (progress) Object.assign(progress, { active: false, status: "ERROR", errorMessage: error instanceof Error ? error.message : String(error) });
                    })
                    .finally(() => {
                        backgroundScanJobs.delete(projectId);
                    });
                backgroundScanJobs.set(projectId, job);
            }

            const currentScanStatus = await loadProjectScanState(supabase, projectId);
            return NextResponse.json({
                success: true,
                active: true,
                background: true,
                message: existingJob ? "Scan is already running." : "Scan started in the background.",
                scanStatus: {
                    ...currentScanStatus,
                    ...retryProgressByProject.get(projectId),
                    active: true,
                    status: "IN_PROGRESS",
                },
            });
        }

        await deleteTemplatePlaceholderFindings(supabase, projectId);
        await resetPrematureScanBaseline(supabase, projectId);

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

        const { data: documentRows, error: documentsError } = await supabase
            .from("documents")
            .select("*")
            .eq("project_id", projectId);
        if (documentsError) throw documentsError;

        let documents = (documentRows || []) as ScanDocument[];
        if (documents.length === 0) {
            return NextResponse.json({ success: true, found: 0, message: "אין מסמכים לסריקה" });
        }

        let duplicateCleanup = { ...EMPTY_DUPLICATE_CLEANUP };
        const shouldDeduplicateProject = !workDocId && !retryDocumentId && (batchCursor === null || batchCursor === 0);

        if (shouldDeduplicateProject) {
            const workDocumentCandidates = documents.filter((document) => getDocumentRole(document) === "WORK_EVIDENCE");
            const exactDuplicateMatches = findExactContentHashDuplicates(workDocumentCandidates);
            const exactDuplicateIds = new Set(exactDuplicateMatches.map((match) => match.duplicate.id));
            const preferredPdfMatches = findPreferredPdfDuplicates(
                workDocumentCandidates.filter((document) => !exactDuplicateIds.has(document.id)),
            );
            const duplicateMatches = [...exactDuplicateMatches, ...preferredPdfMatches];

            if (duplicateMatches.length > 0) {
                console.info("[scan] Confirmed document duplicates:", duplicateMatches.map((match) => ({
                    canonical: match.canonical.title,
                    duplicate: match.duplicate.title,
                    similarity: Number(match.similarity.toFixed(4)),
                })));
                duplicateCleanup = await removePreferredPdfDuplicates(supabase, projectId, duplicateMatches);

                const { data: remainingRows, error: reloadError } = await supabase
                    .from("documents")
                    .select("*")
                    .eq("project_id", projectId);
                if (reloadError) throw reloadError;
                documents = (remainingRows || []) as ScanDocument[];

            }
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

        if (workDocId || retryDocumentId) {
            workDocs = workDocs.filter((d) => d.id === (workDocId || retryDocumentId));
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
        const missingUsefulTextCount = docsForTextPreparation.filter((doc) => !assessDocumentSourceReadiness(doc).extractionComplete).length;

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

            if (workDocId || retryDocumentId) {
                workDocs = workDocs.filter((d) => d.id === (workDocId || retryDocumentId));
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

        if (!workDocs.some((doc) => hasUsefulText(doc)) && batchCursor !== null) {
            const nextCursor = Math.min(batchCursor + 1, allWorkDocs.length);
            const unreadableWorkDoc = workDocs[0];
            const sourceReadiness = assessDocumentSourceReadiness(unreadableWorkDoc || {});
            const excludedSource = ['DRAFT', 'FRAGMENT'].includes(sourceReadiness.documentStatus);
            const sourceMessage = excludedSource
                ? `המסמך דורש בירור גרסה והקשר ואינו משמש כהוראה מחייבת: ${unreadableWorkDoc?.title || 'מסמך ללא שם'}`
                : `לא הושלמה קריאת המסמך: ${unreadableWorkDoc?.title || 'מסמך ללא שם'}`;
            const memoryState = unreadableWorkDoc
                ? await getDocumentScanMemoryState(supabase, projectId, contractDocs, unreadableWorkDoc, allWorkDocs)
                : null;
            const unchanged = memoryState?.status === "SKIPPED";

            if (unchanged) {
                return NextResponse.json({
                    success: true,
                    partial: true,
                    found: 0,
                    warnings: [sourceMessage],
                    memory: { scanned: 0, unchanged: 1, total: 1 },
                    continuation: {
                        done: nextCursor >= allWorkDocs.length,
                        nextCursor,
                        processed: nextCursor,
                        total: allWorkDocs.length,
                    },
                });
            }

            if (unreadableWorkDoc && memoryState) {
                const skippedAt = nowIso();
                await saveScanState(supabase, {
                    project_id: projectId,
                    contract_doc_ids: memoryState.contractDocIds,
                    work_doc_id: unreadableWorkDoc.id,
                    contract_signature: memoryState.contractSignature,
                    work_signature: memoryState.workSignature,
                    scan_signature: memoryState.scanSignature,
                    status: "SKIPPED",
                    findings_count: 0,
                    processed_work_docs: nextCursor,
                    total_work_docs: allWorkDocs.length,
                    current_step: sourceMessage,
                    error_message: excludedSource ? `DOCUMENT_SOURCE_${sourceReadiness.documentStatus}`
                        : `DOCUMENT_SOURCE_${sourceReadiness.status}`,
                    scanned_at: skippedAt,
                    updated_at: skippedAt,
                    completed_at: skippedAt,
                });
                await deleteSupersededScanStates(
                    supabase,
                    projectId,
                    unreadableWorkDoc.id,
                    memoryState.scanSignature,
                );
            }

            return NextResponse.json({
                success: false,
                partial: true,
                found: 0,
                warnings: [sourceMessage],
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
        const warnings = [
            ...textPreparationFailures,
            ...analysisFailures,
            ...duplicateCleanup.storageWarnings.map((warning) => `Duplicate storage cleanup: ${warning}`),
        ];
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
            duplicateCleanup,
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
    const baseContractSignature = buildContractSignature(contractDocs);
    let boundReferences: BoundReferenceDocument[] = [];
    let referenceSourcesAvailable = true;
    try {
        boundReferences = await loadProjectBoundReferenceDocuments({ supabase, projectId, documents: contractDocs.filter(hasUsefulText) });
    } catch (error) {
        referenceSourcesAvailable = false;
        console.warn('[scan] Reference authority verification unavailable:', error);
        analysisFailures.push('Reference authority sources could not be verified; only project contract documents were compared.');
    }
    const contractDocIds = contractDocs.map((doc) => String(doc.id)).sort();
    const orderedContractDocs = sortContractDocumentsByPrecedence(contractDocs.filter(hasUsefulText));
    const contractChunks = buildDocumentScanChunks(
        orderedContractDocs,
        CONTRACT_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const contractSourceChars = orderedContractDocs.reduce(
        (sum, doc) => sum + normalizeDocumentTextForScan(doc.extracted_text).length,
        0,
    );
    const stableProjectWorkDocs = projectWorkDocs
        .filter(hasUsefulText)
        .sort((left, right) => left.id.localeCompare(right.id));
    const projectWorkDocumentsById = new Map(stableProjectWorkDocs.map((doc) => [doc.id, doc]));
    const projectWorkChunks = buildDocumentScanChunks(
        stableProjectWorkDocs,
        WORK_CHUNK_CHARS,
        CHUNK_OVERLAP_CHARS,
    );
    const projectWorkSourceChars = projectWorkDocs.reduce(
        (sum, doc) => sum + normalizeDocumentTextForScan(doc.extracted_text).length,
        0,
    );

    if (contractChunks.length === 0) {
        throw new Error("Contract documents exist, but no extracted text is available for comparison.");
    }

    const scannableWorkDocs = workDocs.filter(hasUsefulText);
    let processedWorkDocs = batchProgress?.offset || 0;
    const totalWorkDocs = batchProgress?.total || scannableWorkDocs.length;

    for (const workDoc of scannableWorkDocs) {
        const fullWorkText = normalizeDocumentTextForScan(workDoc.extracted_text);
        const selectedReferences = selectBoundReferenceDocuments(boundReferences, fullWorkText);
        const comparisonDocuments: ScanDocument[] = [...orderedContractDocs, ...selectedReferences];
        const referenceChunks = buildDocumentScanChunks(selectedReferences, CONTRACT_CHUNK_CHARS, CHUNK_OVERLAP_CHARS);
        const contractSignature = buildReferenceAwareContractSignature(baseContractSignature, selectedReferences);
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
            let oldFindingsToArchive: ReplaceableScanFinding[] = [];

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
                        await deleteSupersededScanStates(supabase, projectId, workDoc.id, scanSignature);
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
                        await deleteSupersededScanStates(supabase, projectId, workDoc.id, scanSignature);
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
                    .select("id, evidence_data, scan_signature, pricing_status, status")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED")
                    .or(`scan_signature.is.null,scan_signature.neq.${scanSignature}`);

                if (oldFindingsError) throw oldFindingsError;
                oldFindingsToArchive = (oldFindings || []) as ReplaceableScanFinding[];
            } else {
                const { data: oldFindings, error: oldFindingsError } = await supabase
                    .from("contradictions")
                    .select("id, evidence_data, scan_signature, pricing_status, status")
                    .eq("project_id", projectId)
                    .eq("source_execution_doc_id", workDoc.id)
                    .neq("status", "ARCHIVED");

                if (oldFindingsError) throw oldFindingsError;
                oldFindingsToArchive = (oldFindings || []) as ReplaceableScanFinding[];
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
                const selectedReferenceChunks = referenceChunks.length ? selectRelevantContractChunks(
                    referenceChunks, workChunk.text, MAX_SELECTED_CONTRACT_CHARS, 1,
                ) : [];
                const bindingContext = selectedReferences.map((source) => [
                    `Incorporated reference source ID: ${source.id}; chapter ${source.reference_authority.section_code || 'document'}; edition ${source.reference_authority.edition || 'named document'}.`,
                    'Incorporation quotes are context only. Quote the actual conflicting requirement, not the incorporation sentence.',
                    ...source.reference_authority.chain.map((link) => `${link.sourceTitle}: ${link.quote.slice(0, 300)}`),
                    ...source.reference_authority.precedence_evidence.slice(0, 2).map((evidence) => `Project precedence rule: ${evidence.quote.slice(0, 350)}`),
                ].join('\n')).join('\n\n');
                const comparisonContext = prepareContractComparisonContext(selectedContractChunks, selectedReferenceChunks, workChunk.text);
                const contractContext = [comparisonContext.text, bindingContext]
                    .filter(Boolean).join('\n\n');
                const relatedWorkChunks = relatedWorkChunksByIndex.get(workChunk.index) || [];
                const relatedWorkContext = formatRelatedWorkTimeline(relatedWorkChunks, workChunk.text);
                const prompt = buildContractScanPrompt({
                    contractHierarchyGuide: SCAN_CONTRACT_HIERARCHY_GUIDE,
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

                const generated = await withScanHeartbeat(
                    supabase,
                    scanSignature,
                    () => generateScanChunkFindings(prompt, findings => assertGeneratedScanSources({
                        findings: findings.map(finding => ({ ...finding,
                            supplied_contract_document_ids: comparisonContext.selection.sources.map(source => source.documentId),
                            context_selection: comparisonContext.selection })),
                        currentWorkDocument: workDoc, contractDocuments: comparisonDocuments,
                    }), buildGroundedScanResponseSchema({ workText: workChunk.text,
                        contractTexts: comparisonContext.selection.sources.flatMap(source => source.selection.source_anchors.map(anchor => anchor.quote)) })),
                );
                // These are server-owned provenance fields, never model assertions.
                chunkFindings.push(...generated.map(finding => ({ ...finding,
                    supplied_contract_document_ids: comparisonContext.selection.sources.map(source => source.documentId),
                    context_selection: comparisonContext.selection,
                })));
            }

            const assessedPoints = dedupeScanFindings(chunkFindings)
                .map((finding) => groundContractScanFinding({
                    finding,
                    currentWorkDocument: workDoc,
                    contractDocuments: comparisonDocuments,
                }))
                .filter((groundedFinding) => !findingIsSupersededByLaterEvidence({
                    finding: groundedFinding,
                    currentWorkDocument: workDoc,
                    relatedWorkDocuments: [...relatedWorkDocumentIds]
                        .map((documentId) => projectWorkDocumentsById.get(documentId))
                        .filter((document): document is ScanDocument => Boolean(document)),
                }))
                .map((groundedFinding) => ({
                    finding: groundedFinding,
                    assessment: assessContractScanFinding({
                        finding: groundedFinding,
                        currentWorkDocument: workDoc,
                        contractDocuments: comparisonDocuments,
                    }),
                }));
            const rejectedPoints = assessedPoints
                .map(({ assessment }) => assessment)
                .filter((assessment) => !assessment.accepted);
            if (rejectedPoints.length > 0) {
                const reasons = [...new Set(rejectedPoints.flatMap((assessment) => assessment.reasons))];
                console.warn(
                    `[scan] Rejected ${rejectedPoints.length} unsupported candidate(s) for ${workDoc.title}: ${reasons.join(", ")}`
                );
            }
            const acceptedPoints = assessedPoints.filter(({ finding, assessment }) => assessment.accepted
                && findingHasActionableWorkEvidence({ finding, currentWorkDocument: workDoc, assessment }));
            const points = acceptedPoints.map(({ finding }) => finding);
            const findingRows = acceptedPoints.map(({ finding: p, assessment }) => {
                const category = assessment.category;
                const matchedContractDoc = assessment.contractDocument;
                const sourceDocument = comparisonDocuments.find((document) => document.id === matchedContractDoc?.id) || null;
                const sourcePointers = contractSourcePointers(sourceDocument);
                const missingEvidence = Array.isArray(p.missing_evidence) ? [...p.missing_evidence] : [];
                missingEvidence.push(...sourceVerificationMissingEvidence(assessment.verificationReasons));
                const contextSelection = p.context_selection as ReturnType<typeof prepareContractComparisonContext>['selection'];

                return {
                    project_id: projectId,
                    title: cleanAiText(assessment.presentation.title),
                    description: cleanAiText(assessment.presentation.description),
                    severity: mapSeverity(category),
                    category,
                    strategy_advice: cleanAiText(p.advice),
                    source_execution_doc_id: workDoc.id,
                    target_contract_doc_id: sourcePointers.targetContractDocumentId,
                    status: "OPEN",
                    scan_signature: scanSignature,
                    evidence_data: {
                        evidence_status: assessment.evidenceStatus,
                        comparison: p.comparison || null,
                        comparison_span_repairs: p.comparison_span_repairs || [],
                        semantic_assessment: assessment.evidenceRelation,
                        analysis_instruction_version: CONTRACT_SCAN_INSTRUCTION_VERSION,
                        contractual_reply_deadline: assessment.replyDeadline,
                        contract_reference_authority: sourcePointers.referenceAuthority,
                        missing_evidence: [...new Set(missingEvidence)],
                        clause_reference: p.clause_reference,
                        contract_page: sourcePointers.referenceAuthority?.page || assessment.contractSourceAnchor?.page || null,
                        work_page: assessment.workSourceAnchor?.page || null,
                        contract_source_anchor: assessment.contractSourceAnchor,
                        work_source_anchor: assessment.workSourceAnchor,
                        context_selection: contextSelection,
                        supplied_contract_document_ids: p.supplied_contract_document_ids,
                        source_repair_suggestions: p.source_repair_suggestions || [],
                        original_instruction: p.original_instruction,
                        new_requirement: p.new_requirement,
                        contract_quote: p.contract_quote,
                        work_quote: p.work_quote,
                        contract_title: matchedContractDoc?.title || null,
                        work_title: workDoc.title,
                        contract_url: null,
                        work_url: null,
                        comparison_type: p.comparison_type || comparisonTypeForCategory(category),
                        document_hierarchy_rule: p.document_hierarchy_rule
                            || (sourcePointers.referenceAuthority ? "incorporated_reference_with_project_precedence"
                                : matchedContractDoc ? "contract_source_controls" : "work_document_is_supporting_evidence"),
                        document_precedence_assessment: cleanAiText(p.document_precedence_assessment) || null,
                        risk_reason: cleanAiText(assessment.presentation.description),
                        confidence: normalizeConfidence(p.confidence) ?? (assessment.contractQuoteMatched ? 0.9 : 0.75),
                        next_check: p.next_check || cleanAiText(p.advice),
                        document_pair: {
                            contract_doc_id: sourcePointers.displayDocumentId,
                            contract_title: matchedContractDoc?.title || null,
                            work_doc_id: workDoc.id,
                            work_title: workDoc.title
                        },
                        context_window: {
                            scan_engine: SCAN_ENGINE_VERSION,
                            contract_source_chars_indexed: contractSourceChars,
                            contract_chunks_indexed: contractChunks.length,
                            incorporated_reference_chunks_indexed: referenceChunks.length,
                            contract_excerpted_for_reference_context: referenceChunks.length > 0,
                            reference_sources_available: referenceSourcesAvailable,
                            contract_chunks_selected_per_work_chunk: MAX_SELECTED_CONTRACT_CHUNKS,
                            contract_sources_supplied: contextSelection.sources.length,
                            contract_context_complete: contextSelection.complete,
                            contract_context_truncated: contextSelection.limitations.some(reason => /clause_truncated|context_budget_exhausted|reference_context_limit/.test(reason)),
                            contract_context_limitations: contextSelection.limitations,
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
                            contract_quote_matched: assessment.contractQuoteMatched,
                            work_quote_matched: assessment.workQuoteMatched,
                            quality_gate_passed: true,
                            quality_gate_version: CONTRACT_SCAN_QUALITY_VERSION,
                            reference_chain_verified: Boolean(sourcePointers.referenceAuthority),
                            source_reading_complete: !assessment.verificationReasons.includes('source_reading_incomplete'),
                            comparison_context_complete: contextSelection.complete,
                            verification_reasons: assessment.verificationReasons,
                            semantic_relation: assessment.evidenceRelation.relation,
                            semantic_assessment_version: assessment.evidenceRelation.version,
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
                await replacePreviousScanFindings({
                    supabase,
                    rows: oldFindingsToArchive,
                    currentScanSignature: scanSignature,
                });
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
            await deleteSupersededScanStates(supabase, projectId, workDoc.id, scanSignature);
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
