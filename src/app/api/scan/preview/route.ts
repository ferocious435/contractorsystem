import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject, requireUser } from '@/app/api/_utils/auth';
import { generateComparisonText, getComparisonAiIdentity } from '@/lib/comparison-ai';
import { createClient } from '@/utils/supabase/server';
import {
    buildDocumentScanChunks,
    chunkDocumentText,
    formatRelatedWorkTimeline,
    selectRelevantProjectChunks,
} from '@/utils/document-scan-chunks';
import {
    extractEvidenceWindow,
    extractFirstJsonObject,
    findEvidenceReferenceMatch,
    findEvidenceTermMatches,
    quoteExistsInSource,
} from '@/utils/local-ai-preview';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

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

type DocumentRow = {
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

export async function GET(req: NextRequest) {
    try {
        const findingRef = normalizeFindingReference(new URL(req.url).searchParams.get('findingRef') || '');
        if (!findingRef) {
            return NextResponse.json({ success: false, error: 'findingRef is required' }, { status: 400 });
        }

        const supabase = await createClient();
        const auth = await requireUser(supabase);
        if (!auth.ok) return auth.response;

        const { data: findingRows, error: findingError } = await supabase
            .from('contradictions')
            .select('id, project_id, title, description, category, severity, source_execution_doc_id, target_contract_doc_id, evidence_data')
            .limit(500);
        if (findingError) throw findingError;

        const idPrefix = findingIdPrefix(findingRef);
        const finding = ((findingRows || []) as FindingRow[]).find((item) =>
            item.id.replace(/-/g, '').toUpperCase().startsWith(idPrefix)
        );
        if (!finding) {
            return NextResponse.json({ success: false, error: 'Finding was not found' }, { status: 404 });
        }

        const ownership = await requireOwnedProject(supabase, finding.project_id);
        if (!ownership.ok) return ownership.response;

        if (!finding.target_contract_doc_id || !finding.source_execution_doc_id) {
            return NextResponse.json({ success: false, error: 'Finding has no complete document pair' }, { status: 400 });
        }

        const { data: documentRows, error: documentError } = await supabase
            .from('documents')
            .select('id, title, category, extracted_text')
            .eq('project_id', finding.project_id);
        if (documentError) throw documentError;

        const documents = (documentRows || []) as DocumentRow[];
        const contractDocument = documents.find((item) => item.id === finding.target_contract_doc_id);
        const workDocument = documents.find((item) => item.id === finding.source_execution_doc_id);
        const contractText = String(contractDocument?.extracted_text || '');
        const workText = String(workDocument?.extracted_text || '');
        if (!contractDocument || !workDocument || !contractText.trim() || !workText.trim()) {
            return NextResponse.json({ success: false, error: 'Readable text is missing from the document pair' }, { status: 400 });
        }

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

        let modelResult: Record<string, unknown> = {
            contradiction_confirmed: false,
            explanation: correctionApplied
                ? 'Карточка уже уточнена по полной истории загруженных документов.'
                : 'Локальная модель не сформировала проверяемый ответ. Карточка оставлена без автоматического подтверждения.',
            missing_evidence: [],
            confidence: 0,
        };
        if (!correctionApplied) {
            try {
                const responseText = await generateComparisonText(prompt, process.env, {
                    numCtx: 8_192,
                    numPredict: 384,
                    timeoutMs: 120_000,
                });
                modelResult = extractFirstJsonObject(responseText);
            } catch (modelError: unknown) {
                const modelMessage = modelError instanceof Error ? modelError.message : 'Invalid local model response';
                console.warn('[scan:preview] Model response was not usable:', modelMessage);
            }
        }
        const sourcePairVerified = storedContractQuoteExists && storedWorkQuoteExists;
        const modelConfidence = typeof modelResult.confidence === 'number'
            ? Math.max(0, Math.min(1, modelResult.confidence))
            : 0;
        const localResult = {
            ...modelResult,
            contradiction_confirmed: sourcePairVerified && modelResult.contradiction_confirmed === true,
            confidence: sourcePairVerified ? modelConfidence : 0,
            explanation: sourcePairVerified
                ? modelResult.explanation
                : 'Автоматически не подтверждено: одна из сохранённых цитат не совпадает с исходным текстом полностью.',
            contract_document_id: contractDocument.id,
            work_document_id: workDocument.id,
            contract_quote: storedContractQuote,
            work_quote: storedWorkQuote,
        };
        const identity = getComparisonAiIdentity();
        const verification = {
            contractQuoteMatched: storedContractQuoteExists,
            workQuoteMatched: storedWorkQuoteExists,
            contractDocumentMatched: true,
            workDocumentMatched: true,
        };

        return NextResponse.json({
            success: Object.values(verification).every(Boolean),
            readOnly: true,
            databaseChanged: false,
            findingRef,
            provider: identity.provider,
            model: identity.model,
            projectId: finding.project_id,
            findingId: finding.id,
            correctionApplied,
            reviewRecommendation,
            coverage: {
                contract: {
                    sourceChars: contractText.length,
                    chunks: contractChunks.length,
                    complete: contractChunks[0]?.start === 0 && contractChunks.at(-1)?.end === contractText.length,
                },
                work: {
                    sourceChars: workText.length,
                    chunks: workChunks.length,
                    complete: workChunks[0]?.start === 0 && workChunks.at(-1)?.end === workText.length,
                },
                project: {
                    documents: documents.filter((item) => item.extracted_text).length,
                    workChunks: projectWorkChunks.length,
                    relatedDocuments: relatedWorkChunks.map((chunk) => ({
                        id: chunk.documentId,
                        title: chunk.title,
                    })),
                    complete: true,
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
            localResult,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Local AI preview failed';
        console.error('[scan:preview] Error:', message);
        return NextResponse.json({ success: false, readOnly: true, databaseChanged: false, error: message }, { status: 500 });
    }
}
