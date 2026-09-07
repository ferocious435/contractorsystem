import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject, requireUser } from '@/app/api/_utils/auth';
import { generateComparisonText, getComparisonAiIdentity } from '@/lib/comparison-ai';
import { createClient } from '@/utils/supabase/server';
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
            .in('id', [finding.target_contract_doc_id, finding.source_execution_doc_id]);
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
        const storedContractQuote = readEvidenceString(evidence, 'contract_quote');
        const storedWorkQuote = readEvidenceString(evidence, 'work_quote');
        const contractEvidenceQuery = [storedContractQuote, finding.title, finding.description]
            .filter(Boolean)
            .join('\n');
        const storedContractQuoteExists = quoteExistsInSource(contractText, storedContractQuote);
        const storedWorkQuoteExists = quoteExistsInSource(workText, storedWorkQuote);
        const contractReferenceMatch = findEvidenceReferenceMatch(contractText, contractEvidenceQuery);
        const workReferenceMatch = findEvidenceReferenceMatch(workText, storedWorkQuote);
        const contractTermMatches = findEvidenceTermMatches(contractText, storedContractQuote);
        const contractExcerpt = contractReferenceMatch?.excerpt
            || extractEvidenceWindow(contractText, contractEvidenceQuery);
        const workExcerpt = extractEvidenceWindow(workText, storedWorkQuote);
        const prompt = `
You verify one known finding in an Israeli construction project. Work only from the two excerpts below.
Return one valid JSON object. All explanatory text must be concise Hebrew.

Rules:
1. Decide whether the excerpts prove the known finding.
2. If either source does not prove the claim, set contradiction_confirmed=false.
3. Do not invent a clause, page, price, date, party, or approval.
4. This is a read-only comparison. Do not suggest that any database record was changed.
5. A permitted manufacturer and a pending approval describe different facts. Pending approval alone is not a contract contradiction.
6. Confirm a contradiction only when the contract excerpt and the work excerpt contain directly conflicting requirements or facts.

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

Return exactly these fields:
{
  "contradiction_confirmed": true,
  "explanation": "short Hebrew explanation",
  "missing_evidence": ["only real missing evidence"],
  "confidence": 0.0
}`;

        const responseText = await generateComparisonText(prompt, process.env, {
            numCtx: 4_096,
            numPredict: 256,
            timeoutMs: 120_000,
        });
        const modelResult = extractFirstJsonObject(responseText);
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
