import type {SupabaseClient} from '@supabase/supabase-js';
import {assessDocumentSourceReadiness,type DocumentSourceInput} from './document-source-readiness';
import {selectContractContext,contractRetrievalWeights,meaningfulRetrievalTerms} from './contract-context-selection';
import {getPreferredProjectAmount,isTrustedBaseContractRow,type LedgerLikeRow} from './project-financials';
import {summarizeIndividualPricing,type IndividualPricingSummary} from './individual-pricing';
import type {LetterSourceRef} from './letter-draft-types';
import {writingRetrievalQuery} from './writing-context-query';
export class ProjectWritingError extends Error {constructor(readonly code:string,readonly status:number,message:string){super(message);}}
export async function ownedWritingProject(client: SupabaseClient, projectId: string, userId: string) {
    const {data, error} = await client.from('projects').select('*').eq('id', projectId).eq('contractor_id', userId).maybeSingle();
    if (error) throw error;
    if (!data || data.id !== projectId || data.contractor_id !== userId) throw new ProjectWritingError('PROJECT_FORBIDDEN', 403, 'הפרויקט אינו זמין בחשבון הזה.');
    return data as Record<string, unknown>;
}
export interface ProjectWritingContext {
    project: {id: string; name: string};
    sources: Array<LetterSourceRef & {sourceId: string}>;
    unverified: Array<{documentId: string; reason: string}>;
    money: {scope: 'PROJECT'; baseNet: number | null; variations: IndividualPricingSummary};
    omittedCount: number;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
type WritingDocument = DocumentSourceInput & {id:string;project_id:string;created_at?:string|null;deleted_at?:string|null};
async function savedProjectDocuments(client: SupabaseClient, projectId: string): Promise<WritingDocument[]> {
    const result: WritingDocument[] = []; let expected: number | null = null;
    for (let start = 0; ; start += 1000) {
        const {data, error, count} = await client.from('documents')
            .select('id,project_id,title,extracted_text,parsed_json,ocr_status,storage_path,file_url,content_hash,created_at,deleted_at', {count: 'exact'})
            .eq('project_id', projectId).is('deleted_at', null).order('id').range(start, start + 999);
        if (error) throw error;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count! < 0 || (expected !== null && expected !== count)
            || data.length !== Math.min(1000, Math.max(0, count! - start)) || data.some(row => row.project_id !== projectId)) {
            throw new ProjectWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'קריאת המסמכים השמורים אינה מלאה ועקבית. יש לנסות שוב.');
        }
        expected = count; result.push(...data);
        if (result.length >= count!) break;
    }
    if (new Set(result.map(row => row.id)).size !== result.length) throw new ProjectWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'קריאת המסמכים כוללת כפילויות.');
    return result;
}
async function savedLedgerRows(client: SupabaseClient, projectId: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []; let expected: number | null = null;
    for (let start = 0; ; start += 1000) {
        const {data, error, count} = await client.from('pricing_ledger').select('*', {count: 'exact'})
            .eq('project_id', projectId).order('id').range(start, start + 999);
        if (error) throw error;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count! < 0 || (expected !== null && expected !== count)
            || data.some(row => row.project_id !== projectId) || (data.length === 0 && start < count!)) {
            throw new ProjectWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'לא הושלמה קריאה עקבית של התמחורים השמורים. יש לנסות שוב.');
        }
        expected = count; result.push(...data);
        if (result.length >= count!) break;
    }
    if (new Set(result.map(row => row.id)).size !== result.length || result.length !== expected) throw new ProjectWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'קריאת התמחורים אינה מלאה.');
    return result;
}
/** Reads saved data only. A context excerpt never establishes contractual authority. */
export async function loadProjectWritingContext(client: SupabaseClient, projectId: string, userId: string, question: string): Promise<ProjectWritingContext> {
    const project = await ownedWritingProject(client, projectId, userId);
    const [documents, rows] = await Promise.all([
        savedProjectDocuments(client, projectId),
        savedLedgerRows(client, projectId),
    ]);
    const unverified: ProjectWritingContext['unverified'] = [];
    const readable = documents.filter(document => assessDocumentSourceReadiness(document).canCompare);
    const retrievalQuery = writingRetrievalQuery(question);
    // Rank the question against the project corpus. Per-document weights gave
    // common administrative words the same importance as the actual subject.
    const weights = contractRetrievalWeights(readable.map(document => document.extracted_text || ''), meaningfulRetrievalTerms(retrievalQuery));
    const acronyms = writingRetrievalQuery((question.match(/[א-ת]{1,5}[״"׳'][א-ת]{1,3}|\b[A-Z]{2,6}\b/gu)||[]).join(' '));
    for(const term of meaningfulRetrievalTerms(acronyms)) weights.set(term,Math.max(1,weights.get(term)||0)*12);
    const candidates = documents.flatMap(document => {
        const readiness = assessDocumentSourceReadiness(document);
        const label = document.title ? document.title + ' — ' : '';
        if (!readiness.canCompare) {
            const reasons = {UNREADABLE: 'לא נקרא תוכן מהימן', EXTRACTION_INCOMPLETE: 'קריאת המקור לא הושלמה', DRAFT: 'מסמך מסומן כטיוטה', FRAGMENT: 'המקור מסומן כקטע בלבד'};
            unverified.push({documentId: document.id, reason: label + (reasons[readiness.status as keyof typeof reasons] || 'מצב המקור דורש בדיקה')}); return [];
        }
        const selection = selectContractContext({id: document.id, extracted_text: document.extracted_text || ''}, retrievalQuery, 2400, weights);
        if (selection.limitations.some(reason => reason !== 'no_subject_match')) unverified.push({documentId: document.id, reason: label + 'נבחר קטע מוגבל; יש לבדוק את ההקשר וההפניות המלאים'});
        return selection.source_anchors.map((anchor, part) => ({document, anchor, part, score: selection.relevance_score || 0}));
    }).sort((a, b) => a.part - b.part || b.score - a.score || a.document.id.localeCompare(b.document.id));
    const sources: ProjectWritingContext['sources'] = []; let characters = 0;
    for (const {document, anchor} of candidates) {
        if (sources.length >= 32 || characters + anchor.quote.length > 32000) continue;
        if (!anchor.quote.trim() || document.extracted_text?.slice(anchor.start, anchor.end) !== anchor.quote) continue;
        sources.push({sourceId: 'S' + (sources.length + 1), documentId: document.id, title: document.title || null,
            pageLabel: anchor.page === null ? null : String(anchor.page), quote: anchor.quote,
            basis: 'DOCUMENT', status: 'VERIFIED', manualNote: null}); characters += anchor.quote.length;
    }
    const traced = rows.filter(row => isTrustedBaseContractRow(row as LedgerLikeRow));
    const tracedComplete = traced.length > 0 && traced.every(row => finite(row.quantity) && row.quantity >= 0 && finite(row.unit_price_excl_vat));
    const budgetKnown = finite(project.budget) && project.budget > 0;
    const baseNet = traced.length && !tracedComplete ? null : tracedComplete || budgetKnown ? getPreferredProjectAmount(budgetKnown ? project.budget as number : null, rows as LedgerLikeRow[]) : null;
    const variations = summarizeIndividualPricing(rows);
    if ([baseNet, variations.totalInclVat, ...Object.values(variations.byStatus).map(status => status.totalInclVat)]
        .some(amount => amount !== null && (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))))) {
        throw new ProjectWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'סכום הפרויקט גדול מטווח הדיוק הכספי שניתן לאמת. יש לבדוק את הנתונים השמורים.');
    }
    return {project: {id: projectId, name: typeof project.name === 'string' ? project.name : ''}, sources, unverified,
        money: {scope: 'PROJECT', baseNet, variations},
        omittedCount: Math.max(0, documents.length - new Set([...sources.map(source => source.documentId), ...unverified.map(source => source.documentId)]).size)};
}
