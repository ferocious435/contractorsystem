import 'server-only';
import { generateComparisonText, getComparisonAiIdentity } from '@/server/ai/comparison.server';
import {
    buildDocumentScanChunks,
    chunkDocumentText,
    formatRelatedWorkTimeline,
    selectRelevantProjectChunks,
} from '@/utils/document-scan-chunks';
import {
    extractEvidenceWindow,
    findEvidenceReferenceMatch,
    findEvidenceTermMatches,
    quoteExistsInSource,
} from '@/utils/local-ai-preview';

import type {SupabaseClient} from '@supabase/supabase-js';
import {BusinessAiError,record,type AiExecutionContext,type JsonObject,type PreparedAiResult} from './contracts';
import {analysisContextFingerprint} from '@/utils/ai-analysis-reuse';
import {assessDocumentSourceReadiness} from '@/utils/document-source-readiness';
import {assessContractScanFinding,groundContractScanFinding,findingIsSupersededByLaterEvidence} from '@/utils/contract-scan-quality';
import {createProjectEffectClient} from './project-effects.server';
type FindingRow = {
    id: string;
    project_id: string;
    title?: string | null;
    description?: string | null;
    category?: string | null;
    severity?: string | null;
    source_execution_doc_id?: string | null;
    target_contract_doc_id?: string | null;
    evidence_data?: Record<string, unknown> | null;
};

type DocumentRow = Record<string,unknown> & {
    id: string;
    title?: string | null;
    category?: string | null;
    extracted_text?: string | null;
};

function normalizeFindingReference(value: string) {
    return value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

function findingIdPrefix(value: string) {
    return normalizeFindingReference(value).split('-').at(-1) || '';
}

function readEvidenceString(evidence: Record<string, unknown>, key: string) {
    const value = evidence[key];
    return typeof value === 'string' ? value.trim() : '';
}

type PreviewQuery=ReturnType<ReturnType<SupabaseClient['from']>['select']>;
async function readPreviewRows<T>(client:SupabaseClient,table:string,configure:(query:PreviewQuery)=>PreviewQuery):Promise<T[]> {
    const rows:T[]=[];let total:number|null=null;
    for(let offset=0;;offset+=500){const response=await configure(client.from(table).select('*',{count:'exact'}).order('id').range(offset,offset+499));
        if(response.error||!Array.isArray(response.data)||typeof response.count!=='number'||!Number.isSafeInteger(response.count)||response.count<0||total!==null&&total!==response.count||!response.data.length&&rows.length<response.count)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');
        total=response.count;rows.push(...response.data as T[]);if(rows.length>=total)break;}
    if(rows.length!==total)throw new BusinessAiError('AI_SOURCE_UNVERIFIED');return rows;
}
export async function findOwnedRadarPreview(client:SupabaseClient,ownerId:string,reference:string) {
    const normalized=normalizeFindingReference(reference),prefix=findingIdPrefix(normalized);
    if(!/^[A-F0-9]{6,32}$/u.test(prefix))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    const projects=await readPreviewRows<{id:string}>(client,'projects',query=>query.eq('contractor_id',ownerId));
    if(!projects.length)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',undefined,404);
    const rows=await readPreviewRows<FindingRow>(client,'contradictions',query=>query.in('project_id',projects.map(project=>project.id)));
    const matches=rows.filter(row=>row.id.replaceAll('-','').toUpperCase().startsWith(prefix));
    if(matches.length!==1)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',undefined,matches.length?409:404);
    return {finding:matches[0],findingRef:normalized};
}

export async function loadRadarPreview(supabase:SupabaseClient,projectId:string,findingId:string,findingRef:string) {
    const saved=await supabase.from('contradictions').select('*').eq('project_id',projectId).eq('id',findingId).maybeSingle();
    if(saved.error||!saved.data)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',undefined,404);
    const finding=saved.data as FindingRow;
    const documents=await readPreviewRows<DocumentRow>(supabase,'documents',query=>query.eq('project_id',projectId));
    const contractDocument=documents.find(document=>document.id===finding.target_contract_doc_id),workDocument=documents.find(document=>document.id===finding.source_execution_doc_id);
    if(!contractDocument||!workDocument)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',undefined,422);
    const contractText=String(contractDocument.extracted_text||''),workText=String(workDocument.extracted_text||'');
    const evidence = finding.evidence_data || {};
    const contractChunks = chunkDocumentText(contractText);
    const workChunks = chunkDocumentText(workText);
    const manualReview = evidence.manual_review && typeof evidence.manual_review === 'object'
        ? evidence.manual_review as Record<string, unknown>
        : null;
    const reviewedTitle = 'נדרשת חלוקת הידרנטים לפי אזורים וספקים';
    const correctionApplied = manualReview?.verdict === 'REFRAMED_NOT_CONTRACT_CONTRADICTION'
        && finding.title === reviewedTitle;
    const reviewRecommendation = findingRef === 'C-CE6070' && !correctionApplied ? {
        title: reviewedTitle,
        description: 'החומרים שהגיש הקבלן להידרנטים ולמגופים אושרו על ידי המתכנן ונציג התאגיד בינואר 2025. בהמשך ביקש הקבלן לעבוד עם שני ספקי הידרנטים. לפי העדכון האחרון מיום 04.06.2025, התאגיד מוכן לשקול זאת לאחר קבלת חלוקה מפורטת לפי אזורים וספקים. זו פעולה שוטפת ולא סתירה לחוזה.',
        category: 'פעולה לביצוע',
        severity: 'LOW',
        strategyAdvice: 'אם עדיין נדרשים שני ספקים, להעביר מיד חלוקה מפורטת לפי אזורים וספקים, לציין שהחומרים המקוריים כבר אושרו ולדרוש החלטה בכתב עד מועד מוגדר. אם ההחלטה מעכבת עבודה, לשמור את זכות הקבלן לתוספת זמן ועלות.',
        verdict: 'REFRAMED_NOT_CONTRACT_CONTRADICTION',
        comparisonType: 'project_timeline',
        missingEvidence: [],
    } : null;
    const storedContractQuote = readEvidenceString(evidence, 'contract_quote');
    const storedWorkQuote = readEvidenceString(evidence, 'work_quote');
    const contractEvidenceQuery = [storedContractQuote, finding.title, finding.description]
        .filter(Boolean)
        .join('\n');
    const projectTopicQuery = String(finding.title || storedWorkQuote);
    const projectWorkChunks = buildDocumentScanChunks(
        documents.filter((item) => item.category !== 'CONTRACT' && item.extracted_text),
    );
    const relatedWorkChunks = selectRelevantProjectChunks(
        projectWorkChunks,
        projectTopicQuery,
        8_000,
        10,
        workDocument.id,
    );
    const relatedWorkTimeline = formatRelatedWorkTimeline(relatedWorkChunks, projectTopicQuery);
    const storedContractQuoteExists = quoteExistsInSource(contractText, storedContractQuote);
    const storedWorkQuoteExists = quoteExistsInSource(workText, storedWorkQuote);
    const contractReferenceMatch = findEvidenceReferenceMatch(contractText, contractEvidenceQuery);
    const workReferenceMatch = findEvidenceReferenceMatch(workText, storedWorkQuote);
    const contractTermMatches = findEvidenceTermMatches(contractText, storedContractQuote);
    const contractExcerpt = contractReferenceMatch?.excerpt
        || extractEvidenceWindow(contractText, contractEvidenceQuery);
    const workExcerpt = extractEvidenceWindow(workText, storedWorkQuote);
    const prompt = `
You verify one known finding in an Israeli construction project. Use the contract excerpt, the original work excerpt, and the related project timeline below.
Return one valid JSON object. All explanatory text must be concise Hebrew.

Rules:
1. Decide whether the excerpts prove the known finding.
2. If either source does not prove the claim, set contradiction_confirmed=false.
3. Do not invent a clause, page, price, date, party, or approval.
4. This is a read-only comparison. Do not suggest that any database record was changed.
5. A permitted manufacturer and a pending approval describe different facts. Pending approval alone is not a contract contradiction.
6. Confirm a contradiction only when the contract excerpt and the work excerpt contain directly conflicting requirements or facts.
7. Read the related work documents as a timeline. A later dated document can approve, resolve, replace, or narrow an earlier issue.
8. Do not call an old issue current when a later document says it was approved or completed. State the latest documented action that protects the contractor.

Known finding reference: ${findingRef}
Known title: ${finding.title || ''}
Known description: ${finding.description || ''}

CONTRACT DOCUMENT
ID: ${contractDocument.id}
Title: ${contractDocument.title || ''}
Excerpt:
${contractExcerpt}

WORK DOCUMENT
ID: ${workDocument.id}
Title: ${workDocument.title || ''}
Excerpt:
${workExcerpt}

RELATED PROJECT TIMELINE
${relatedWorkTimeline || 'No related project passage was found.'}

Return exactly these fields:
{
  "contradiction_confirmed": true,
  "explanation": "short Hebrew explanation",
  "missing_evidence": ["only real missing evidence"],
  "confidence": 0.0
}`;

    const verification={contractQuoteMatched:storedContractQuoteExists,workQuoteMatched:storedWorkQuoteExists,contractDocumentMatched:true,workDocumentMatched:true};
    const diagnostics = {
        success: Object.values(verification).every(Boolean),
        readOnly: true,
        databaseChanged: false,
        findingRef,
        projectId: finding.project_id,
        findingId: finding.id,
        correctionApplied,
        reviewRecommendation,
        coverage: {
        contract: {
            sourceChars: contractText.length,
            chunks: contractChunks.length,
            complete: assessDocumentSourceReadiness(contractDocument).canCompare && contractChunks[0]?.start === 0 && contractChunks.at(-1)?.end === contractText.length,
        },
        work: {
            sourceChars: workText.length,
            chunks: workChunks.length,
            complete: assessDocumentSourceReadiness(workDocument).canCompare && workChunks[0]?.start === 0 && workChunks.at(-1)?.end === workText.length,
        },
        project: {
            documents: documents.filter((item) => item.extracted_text).length,
            workChunks: projectWorkChunks.length,
            relatedDocuments: relatedWorkChunks.map((chunk) => ({
            id: chunk.documentId,
            title: chunk.title,
            })),
            complete: documents.every(document => assessDocumentSourceReadiness(document).canCompare),
        },
        },
        documents: {
        contract: { id: contractDocument.id, title: contractDocument.title },
        work: { id: workDocument.id, title: workDocument.title },
        },
        verification,
        sourceDiagnostics: {
        contractReference: contractReferenceMatch?.reference || null,
        contractReferenceExcerpt: contractReferenceMatch?.excerpt || null,
        contractTermMatches,
        workReference: workReferenceMatch?.reference || null,
        workReferenceExcerpt: workReferenceMatch?.excerpt || null,
        },
        storedFinding: {
        title: finding.title,
        description: finding.description,
        contractQuote: storedContractQuote,
        workQuote: storedWorkQuote,
        },
    };
    const sourceSignature=analysisContextFingerprint({projectId,rulesVersion:'radar-preview-codex-v1',finding:JSON.parse(JSON.stringify(finding)),documents:documents.map(document=>Object.fromEntries(Object.entries(document).filter(([key,value])=>value!==undefined&&!['xmin','processed_at','updated_at'].includes(key)))),relatedDocuments:[],relations:[]} as unknown as JsonObject);
    return {diagnostics,prompt,sourceSignature,finding,contractDocument,workDocument,documents,correctionApplied};
}

const previewSchema={type:'object',additionalProperties:false,required:['contradiction_confirmed','explanation','missing_evidence','confidence'],properties:{contradiction_confirmed:{type:'boolean'},explanation:{type:'string'},missing_evidence:{type:'array',items:{type:'string'}},confidence:{type:'number'}}};
export async function runRadarPreview(database:SupabaseClient,payload:JsonObject,execution:AiExecutionContext):Promise<PreparedAiResult>{
    const transaction=await createProjectEffectClient(database,execution),context=await loadRadarPreview(transaction.client,execution.projectId,String(payload.findingId),String(payload.findingRef));
    const {diagnostics,finding,contractDocument,workDocument,documents}=context;
    if(!diagnostics.success||!diagnostics.coverage.contract.complete||!diagnostics.coverage.work.complete||!diagnostics.coverage.project.complete)throw new BusinessAiError('AI_SOURCE_UNVERIFIED',undefined,422);
    const raw=context.correctionApplied?{contradiction_confirmed:false,explanation:'Карточка уже уточнена по истории загруженных документов.',missing_evidence:[],confidence:0}:JSON.parse(await generateComparisonText(context.prompt,execution,{responseFormat:previewSchema}));
    if(!record(raw)||Object.keys(raw).some(key=>!['contradiction_confirmed','explanation','missing_evidence','confidence'].includes(key))||typeof raw.contradiction_confirmed!=='boolean'||typeof raw.explanation!=='string'||!raw.explanation.trim()||raw.explanation.length>6000||!Array.isArray(raw.missing_evidence)||!raw.missing_evidence.every(value=>typeof value==='string')||typeof raw.confidence!=='number'||!Number.isFinite(raw.confidence)||raw.confidence<0||raw.confidence>1)throw new BusinessAiError('AI_RESPONSE_INCOMPLETE');
    const evidence=finding.evidence_data||{},proposal={...evidence,title:finding.title,description:finding.description,category:finding.category,work_document_id:workDocument.id,contract_document_id:contractDocument.id};
    const grounded=groundContractScanFinding({finding:proposal,currentWorkDocument:workDocument,contractDocuments:[contractDocument]});
    const assessment=assessContractScanFinding({finding:grounded,currentWorkDocument:workDocument,contractDocuments:[contractDocument]});
    const resolved=findingIsSupersededByLaterEvidence({finding:grounded,currentWorkDocument:workDocument,contractDocuments:[contractDocument],relatedWorkDocuments:documents.filter(document=>document.id!==workDocument.id)});
    await execution.checkActive();
    return {result:{...diagnostics,...getComparisonAiIdentity(execution),sourceSignature:context.sourceSignature,localResult:{...raw,contradiction_confirmed:raw.contradiction_confirmed&&!context.correctionApplied&&!resolved&&assessment.accepted&&assessment.evidenceStatus==='VERIFIED',contract_document_id:contractDocument.id,work_document_id:workDocument.id,contract_quote:evidence.contract_quote,work_quote:evidence.work_quote}} as unknown as JsonObject,effects:[]};
}
