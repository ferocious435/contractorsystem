import 'server-only';
import {enrichProjectFindingsWithSupportSources} from '@/utils/support-source-enrichment-server';
import { buildRadarEvidenceAssessment } from '@/utils/radar-saved-finding-review';
import { refreshSavedIssueHistories, savedIssueHistory } from '@/utils/radar-issue-history-server';
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
import { prepareDocumentAnalysisInput } from "@/utils/document-text-extraction";
import { parseScanFindings } from "@/utils/scan-ai-response";
import {
    assessContractScanFinding,
    assertGeneratedScanSources,
    buildContractScanPrompt,
    buildGroundedScanResponseSchema,
    CONTRACT_SCAN_INSTRUCTION_VERSION,
    CONTRACT_SCAN_MEMORY_VERSION,
    CONTRACT_SCAN_RESPONSE_SCHEMA,
    findingHasActionableWorkEvidence,
    findingIsSupersededByLaterEvidence,
    findSupersedingWorkEvidence,
    groundContractScanFinding,
    isTemplatePlaceholderFinding,
    sourceVerificationMissingEvidence,
} from "@/utils/contract-scan-quality";
import { generateComparisonText, getComparisonAiIdentity } from "@/server/ai/comparison.server";
import { assessDocumentSourceReadiness } from '@/utils/document-source-readiness';
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    replacePreviousScanFindings,
    deleteUnsupportedAutomaticFindings,
    consolidateRepeatedAutomaticFindings,
    deleteObsoleteAutomaticArchiveRows,
    type ReplaceableScanFinding,
} from "@/utils/scan-finding-retention";
import { loadProjectComparisonReferenceContext } from "@/utils/document-reference-authority-server";
import { isRequirementContractSource } from '@/utils/radar-requirement-context';
import { buildReferenceAwareContractSignature, contractSourcePointers, selectBoundReferenceDocuments,
    type BoundReferenceDocument } from "@/utils/bound-reference-comparison";

import {createProjectEffectClient} from './project-effects.server';
import {BusinessAiError,record,type AiExecutionContext,type JsonObject,type PreparedAiResult} from './contracts';
import {analysisContextFingerprint,reusableAnalysisKeys,observedHistoricalIdentities} from '@/utils/ai-analysis-reuse';
import {archiveContradictionRows} from '@/utils/contradiction-archive';
import {buildScanRetryQueue} from '@/utils/scan-retry-queue';
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

async function generateScanChunkFindings(prompt:string,execution:AiExecutionContext,validate?:(findings:ScanFinding[])=>void,responseSchema:Record<string,unknown>=CONTRACT_SCAN_RESPONSE_SCHEMA) {
    const response=await generateComparisonText(prompt,execution,{responseFormat:responseSchema});
    const findings=parseScanFindings(response,{requireSemantic:true}) as ScanFinding[];validate?.(findings);return findings;
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

export async function loadProjectScanState(supabase: SupabaseClient, projectId: string, workDocId?: string | null) {
    const rows:DocumentScanStateRow[]=[];let expected:number|null=null;
    for(let offset=0;;offset+=500){let query=supabase.from('document_scan_state').select(SCAN_STATE_COLUMNS,{count:'exact'}).eq('project_id',projectId).order('updated_at',{ascending:false}).order('id').range(offset,offset+499);if(workDocId)query=query.eq('work_doc_id',workDocId);
        const {data,error,count}=await query;if(error)throw error;
        if(!Array.isArray(data)||typeof count!=='number'||!Number.isSafeInteger(count)||count<0||expected!==null&&count!==expected||!data.length&&rows.length<count)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
        expected=count;rows.push(...data as DocumentScanStateRow[]);if(rows.length>=count)break;
    }
    if(rows.length!==expected)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');return summarizeScanState(rows);
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


function cacheDocument(document:ScanDocument):JsonObject {
    return Object.fromEntries(Object.entries(document).filter(([key,value])=>value!==undefined&&!['xmin','updated_at','processed_at','__scanRole'].includes(key))) as JsonObject;
}
function validCachedFinding(row:Record<string,unknown>,work:ScanDocument,contracts:ScanDocument[],related:ScanDocument[]):boolean {
    if(!record(row.evidence_data)||row.source_execution_doc_id!==work.id)return false;
    const evidence=row.evidence_data,finding={...evidence,title:row.title,description:row.description,category:row.category,advice:row.strategy_advice,
        work_document_id:row.source_execution_doc_id,contract_document_id:(record(evidence.contract_reference_authority)?evidence.contract_reference_authority.reference_chunk_id:null)||row.target_contract_doc_id} as ScanFinding;
    try{assertGeneratedScanSources({findings:[finding],currentWorkDocument:work,contractDocuments:contracts});
        const grounded=groundContractScanFinding({finding,currentWorkDocument:work,contractDocuments:contracts});
        const assessment=assessContractScanFinding({finding:grounded,currentWorkDocument:work,contractDocuments:contracts});
        return assessment.accepted&&findingHasActionableWorkEvidence({finding:grounded,currentWorkDocument:work,assessment})
            && !findingIsSupersededByLaterEvidence({finding:grounded,currentWorkDocument:work,contractDocuments:contracts,relatedWorkDocuments:related});
    }catch{return false;}
}

/** Prepare, validate and coalesce changes against a private snapshot. No business write leaves
 * this function; the worker commits the returned effects with the source/lease check. */
export async function runRadarScan(database:SupabaseClient,payload:JsonObject,execution:AiExecutionContext):Promise<PreparedAiResult> {
    const transaction=await createProjectEffectClient(database,execution),supabase=transaction.client,projectId=execution.projectId;
    const response=await supabase.from('documents').select('*').eq('project_id',projectId);if(response.error)throw response.error;
    const documents=(response.data||[]) as ScanDocument[],contractDocs=documents.filter(document=>getDocumentRole(document)==='CONTRACT_BASE');
    const allWorkDocs=documents.filter(document=>getDocumentRole(document)==='WORK_EVIDENCE').sort((a,b)=>a.id.localeCompare(b.id));
    const target=payload.workDocId||payload.retryDocumentId;
    let workDocs=target?allWorkDocs.filter(document=>document.id===target):allWorkDocs;
    if(payload.retrySkipped===true){const states=await supabase.from('document_scan_state').select('*').eq('project_id',projectId);if(states.error)throw states.error;
        const queued=new Set(buildScanRetryQueue(allWorkDocs,states.data||[]).map(item=>item.id));workDocs=workDocs.filter(document=>queued.has(document.id));
        if(!workDocs.length)return {result:{success:true,found:0,memory:{scanned:0,unchanged:0,total:0},scanStatus:await loadProjectScanState(supabase,projectId)},effects:[]};
    }
    if(!contractDocs.length||!workDocs.length)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',!contractDocs.length?'לא נמצאו מסמכי בסיס להשוואה.':'לא נמצאו מסמכי ביצוע לבדיקה.',422);
    const prepared=await ensureScanTextForDocuments(supabase,[...contractDocs,...workDocs]);
    const byId=new Map(prepared.prepared.map(document=>[document.id,document]));
    const contracts=contractDocs.map(document=>byId.get(document.id)||document),work=workDocs.map(document=>byId.get(document.id)||document),timeline=allWorkDocs.map(document=>byId.get(document.id)||document);
    const blockers=[...contracts,...timeline].filter(document=>!hasUsefulText(document)),warnings=[...prepared.failures];
    if(blockers.length){
        warnings.push(...blockers.map(document=>`לא הושלמה בדיקת המקור: ${document.title||document.id} (${assessDocumentSourceReadiness(document).status})`));
        for(const document of work){const identity=getComparisonAiIdentity(execution),stamp=nowIso();await saveScanState(supabase,{project_id:projectId,work_doc_id:document.id,contract_doc_ids:contracts.map(item=>item.id),contract_signature:buildContractSignature(contracts),work_signature:getDocumentSignature(document),scan_signature:buildScanSignature(projectId,buildContractSignature(contracts),buildContractSignature(timeline.filter(item=>item.id!==document.id)),getDocumentSignature(document),identity.provider+':'+identity.model),status:'SKIPPED',findings_count:0,total_work_docs:work.length,processed_work_docs:0,current_step:'נדרשת השלמת קריאת המקורות',error_message:'DOCUMENT_SOURCE_UNVERIFIED',scanned_at:stamp,updated_at:stamp,completed_at:stamp});}
        return {result:{success:false,partial:true,found:0,warnings,memory:{scanned:0,unchanged:0,total:work.length},scanStatus:await loadProjectScanState(supabase,projectId)},effects:await transaction.effects()};
    }
    const identities:JsonObject[]=[...observedHistoricalIdentities],seenModels=new Set<string>();let historyCount:number|null=null,readJobs=0;
    for(let offset=0;;offset+=500){const jobs=await database.from('project_ai_jobs').select('id,profile_snapshot',{count:'exact'}).eq('project_id',projectId).eq('owner_id',execution.ownerId).eq('kind','scan').eq('state','SUCCEEDED').order('id').range(offset,offset+499);
        if(jobs.error||!Array.isArray(jobs.data)||typeof jobs.count!=='number'||!Number.isSafeInteger(jobs.count)||jobs.count<0||historyCount!==null&&historyCount!==jobs.count||!jobs.data.length&&readJobs<jobs.count)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
        historyCount=jobs.count;readJobs+=jobs.data.length;
        for(const row of jobs.data){const profile=row.profile_snapshot;if(record(profile)&&profile.ownerId===execution.ownerId&&typeof profile.model==='string'&&!seenModels.has(profile.model)){seenModels.add(profile.model);identities.push({kind:'codex',provider:'Codex',model:profile.model});}}
        if(readJobs>=historyCount)break;
    }
    if(readJobs!==historyCount)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
    const results=await analyzeDirectly(supabase,projectId,contracts,work,timeline,execution,identities);
    warnings.push(...results.__analysisFailures||[]);
    if(!warnings.length){await deleteTemplatePlaceholderFindings(supabase,projectId);await deleteUnsupportedAutomaticFindings(supabase,projectId);await consolidateRepeatedAutomaticFindings(supabase,projectId);await deleteObsoleteAutomaticArchiveRows(supabase,projectId);}
    const supportEnrichment=!warnings.length?await enrichProjectFindingsWithSupportSources({supabase,projectId,execution}):null;
    if(supportEnrichment?.failed)warnings.push('בדיקת חלק ממקורות התמחור לא הושלמה; הפרטים מסומנים לבדיקה.');
    await execution.checkActive();
    const publicResults=results.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='xmin')));
    return {result:{success:warnings.length===0,partial:warnings.length>0,found:results.length,contradictions:publicResults,warnings,supportEnrichment,memory:{scanned:results.__scannedDocuments||0,unchanged:results.__cachedDocuments||0,total:work.length},scanStatus:await loadProjectScanState(supabase,projectId),analysisIdentity:getComparisonAiIdentity(execution)} as unknown as JsonObject,effects:await transaction.effects()};
}

async function analyzeDirectly(
    supabase: SupabaseClient,
    projectId: string,
    contractDocs: ScanDocument[],
    workDocs: ScanDocument[],
    projectWorkDocs: ScanDocument[],
    execution: AiExecutionContext,
    historicalIdentities: JsonObject[],
    batchProgress?: { offset: number; total: number },
): Promise<ScanResults> {
    const results: ScanResults = [] as ScanResults;
    const analysisFailures: string[] = [];
    let cachedDocumentCount = 0;
    let scannedDocumentCount = 0;
    const aiIdentity = getComparisonAiIdentity(execution);
    const aiSignature = `${aiIdentity.provider}:${aiIdentity.model}`;
    const baseContractSignature = buildContractSignature(contractDocs);
    let boundReferences: BoundReferenceDocument[] = [];
    let comparisonReferenceContext: Awaited<ReturnType<typeof loadProjectComparisonReferenceContext>> | undefined;
    let referenceSourcesAvailable = true;
    try {
        comparisonReferenceContext = await loadProjectComparisonReferenceContext({ supabase, projectId, documents: contractDocs.filter(isRequirementContractSource) });
        boundReferences = comparisonReferenceContext.boundDocuments;
    } catch (error) {
        referenceSourcesAvailable = false;
        console.warn('[scan] Reference authority verification unavailable:', error);
        throw new BusinessAiError('AI_SOURCE_UNVERIFIED','Не удалось прочитать источники, определяющие требования. Сохранённые выводы не изменены.',422);
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
    // Update known issues even when the changed message produces no new candidate.
    // This precedes model generation, candidate filtering and source-memory skips.
    const issueHistoryDocuments = [...contractDocs, ...projectWorkDocs];
    await refreshSavedIssueHistories(supabase, projectId, issueHistoryDocuments);
    let processedWorkDocs = batchProgress?.offset || 0;
    const totalWorkDocs = batchProgress?.total || scannableWorkDocs.length;

    for (const workDoc of scannableWorkDocs) {
        await execution.checkActive();
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
        const legacyScanSignature = buildScanSignature(
            projectId,
            contractSignature,
            relatedWorkSignature,
            workSignature,
            aiSignature,
        );
        const relatedDocuments=[...relatedWorkDocumentIds].map(id=>projectWorkDocumentsById.get(id)!).filter(Boolean);
        const context={projectId,documents:[...comparisonDocuments,workDoc].map(cacheDocument),relatedDocuments:relatedDocuments.map(cacheDocument),relations:[{referenceSignature:comparisonReferenceContext?.signature||'',relatedWorkSignature}],rulesVersion:SCAN_ENGINE_VERSION} as unknown as JsonObject;
        const reuseInputs={context,material:{format:'scan-memory',fields:{engineVersion:SCAN_ENGINE_VERSION,projectId,contractFingerprint:contractSignature,workFingerprint:workSignature,relatedWorkFingerprint:relatedWorkSignature}}} as JsonObject;
        const scanSignature=reusableAnalysisKeys(reuseInputs,aiIdentity,historicalIdentities)[0];
        if(!scanSignature)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
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
            // Resolve existing issues before replacement. A later approval is retained as
            // dated project history, rather than erased as an obsolete automatic row.
            const previous=await supabase.from('contradictions').select('*').eq('project_id',projectId).eq('source_execution_doc_id',workDoc.id).neq('status','ARCHIVED');
            if(previous.error)throw previous.error;
            for(const row of previous.data||[]){if(!row.scan_signature||row.pricing_status==='PRICED'||row.status==='MOVED_TO_PRICING'||!record(row.evidence_data))continue;
                const finding=groundContractScanFinding({finding:{...row.evidence_data,title:row.title,category:row.category,description:row.description,work_document_id:workDoc.id,contract_document_id:(record(row.evidence_data.contract_reference_authority)?row.evidence_data.contract_reference_authority.reference_chunk_id:null)||row.target_contract_doc_id},currentWorkDocument:workDoc,contractDocuments:comparisonDocuments});
                const assessment=assessContractScanFinding({finding,currentWorkDocument:workDoc,contractDocuments:comparisonDocuments});
                const resolution=assessment.accepted?findSupersedingWorkEvidence({finding,currentWorkDocument:workDoc,relatedWorkDocuments:relatedDocuments,contractDocuments:comparisonDocuments}):null;
                if(resolution)await archiveContradictionRows(supabase,[row],{archive_reason:'Resolved by later documented project evidence.',archived_at:nowIso(),resolution_document_id:resolution.documentId,resolution_document_title:resolution.documentTitle,resolution_quote:resolution.quote});
            }
            let oldFindingsToArchive: ReplaceableScanFinding[] = [];

            const states=await supabase.from('document_scan_state').select('*').eq('project_id',projectId).eq('work_doc_id',workDoc.id);
            if(states.error)throw states.error;
            // The historical key is itself proof of the complete original packet: engine,
            // full contract/work/related fingerprints and the recorded historical identity.
            const legacyInputs={...reuseInputs,historicalContextHash:analysisContextFingerprint(context)};
            const candidates=new Set([...reusableAnalysisKeys(reuseInputs,aiIdentity,historicalIdentities),...reusableAnalysisKeys(legacyInputs,aiIdentity,[aiIdentity,...historicalIdentities]),legacyScanSignature]);
            let reused=false;
            for(const saved of (states.data||[]) as DocumentScanStateRow[]){
                if(saved.status!=='COMPLETED'||!candidates.has(saved.scan_signature)||saved.contract_signature!==contractSignature||saved.work_signature!==workSignature)continue;
                const cached=await supabase.from('contradictions').select('*').eq('project_id',projectId).eq('scan_signature',saved.scan_signature);
                if(cached.error)throw cached.error;
                if(!Number.isSafeInteger(saved.findings_count)||saved.findings_count!==cached.data?.length)continue;
                if(!(cached.data||[]).every(row=>validCachedFinding(row,workDoc,comparisonDocuments,relatedDocuments)))continue;
                results.push(...(cached.data||[]).filter(row=>row.status!=='ARCHIVED').map(row=>({...row,__cached:true})));
                cachedDocumentCount++;processedWorkDocs++;reused=true;break;
            }
            if(reused)continue;
            const old=await supabase.from('contradictions').select('id,evidence_data,scan_signature,pricing_status,status').eq('project_id',projectId).eq('source_execution_doc_id',workDoc.id).neq('status','ARCHIVED');
            if(old.error)throw old.error;oldFindingsToArchive=(old.data||[]) as ReplaceableScanFinding[];

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
                    () => generateScanChunkFindings(prompt, execution, findings => assertGeneratedScanSources({
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
                    contractDocuments: comparisonDocuments,
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
                const checkedEvidence = buildRadarEvidenceAssessment(p, assessment);
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
                        issue_history: savedIssueHistory({ id: '', title: String(cleanAiText(assessment.presentation.title) || ''),
                            evidence_data: { work_quote: String(p.work_quote || '') } }, issueHistoryDocuments, { ...comparisonReferenceContext, projectId }),
                        comparison: p.comparison || null,
                        comparison_span_repairs: p.comparison_span_repairs || [],
                        analysis_instruction_version: CONTRACT_SCAN_INSTRUCTION_VERSION,
                        contractual_reply_deadline: assessment.replyDeadline,
                        contract_reference_authority: sourcePointers.referenceAuthority,
                        missing_evidence: [...new Set(missingEvidence)],
                        clause_reference: p.clause_reference,
                        contract_page: sourcePointers.referenceAuthority?.page || assessment.contractSourceAnchor?.page || null,
                        work_page: assessment.workSourceAnchor?.page || null,
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
                        ...checkedEvidence,
                        source_verification: {
                            ...checkedEvidence.source_verification,
                            reference_chain_verified: Boolean(sourcePointers.referenceAuthority),
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
            if(execution.signal.aborted)throw new BusinessAiError('AI_CANCELLED',undefined,409);
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
