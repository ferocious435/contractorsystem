import type {SupabaseClient} from '@supabase/supabase-js';
import {checkOllamaRuntime} from '@/lib/ollama';
import {isOllamaProvider} from './ai-readiness';
import {assessDocumentSourceReadiness} from './document-source-readiness';
import {selectContractContext} from './contract-context-selection';
import {getPreferredProjectAmount, isTrustedBaseContractRow, type LedgerLikeRow} from './project-financials';
import {summarizeIndividualPricing, type IndividualPricingSummary} from './individual-pricing';
import type {LetterSourceRef} from './letter-draft-types';
import {isRecord} from './letter-snapshot';

export class LocalWritingError extends Error {
    constructor(readonly code: string, readonly status: number, message: string) {super(message);}
}
export const localInvalidResponse = () => new LocalWritingError('LOCAL_RESPONSE_INVALID', 502, 'התשובה המקומית אינה מתאימה לבדיקה בטוחה. הטקסט הקודם נשאר זמין; אפשר לנסות שוב.');
export const localInvalidInput = () => new LocalWritingError('LOCAL_INVALID_INPUT', 400, 'פרטי הבקשה אינם מלאים או אינם תקינים.');
export const isLocalUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function localWritingFailure(error: unknown): Response {
    const failure = error instanceof LocalWritingError ? error
        : isRecord(error) && error.code === 'PT422' ? new LocalWritingError('LETTER_NOT_READY', 422, 'הסכומים או המקורות עדיין דורשים בדיקה.')
            : isRecord(error) && error.code === 'PT409' ? new LocalWritingError('LETTER_CONFLICT', 409, 'התמחורים או המקורות השתנו. יש לבדוק אותם שוב.')
                : new LocalWritingError('LOCAL_WRITING_FAILED', 500, 'הכנת הטקסט לא הושלמה. הנתונים והטקסט הקודם נשארו זמינים.');
    return Response.json({success: false, code: failure.code, error: failure.message}, {status: failure.status, headers: {'Cache-Control': 'no-store'}});
}
export async function localRequestBody(request: Request): Promise<Record<string, unknown>> {
    try {
        if (Number(request.headers.get('content-length') || 0) > 64_000) throw localInvalidInput();
        const text = await request.text(); if (text.length > 64_000) throw localInvalidInput();
        const value: unknown = JSON.parse(text); if (!isRecord(value)) throw localInvalidInput(); return value;
    } catch {throw localInvalidInput();}
}
export async function requireLocalWritingRuntime(): Promise<void> {
    if (!isOllamaProvider(process.env)) throw new LocalWritingError('AI_UNAVAILABLE', 503, 'העיבוד המקומי אינו זמין כעת. אפשר להמשיך לערוך ולשמור ידנית.');
    const state = await checkOllamaRuntime();
    if (!state.reachable) throw new LocalWritingError('AI_UNAVAILABLE', 503, 'השרת המקומי אינו זמין כעת. אפשר לנסות שוב ולהמשיך לערוך ידנית.');
    if (!state.modelInstalled) throw new LocalWritingError('AI_MODEL_MISSING', 503, 'המודל המקומי המוגדר אינו נמצא. הטקסט נשאר זמין לעריכה ידנית.');
}
export async function ownedLocalProject(client: SupabaseClient, projectId: string, userId: string) {
    const {data, error} = await client.from('projects').select('*').eq('id', projectId).eq('contractor_id', userId).maybeSingle();
    if (error) throw error;
    if (!data || data.id !== projectId || data.contractor_id !== userId) throw new LocalWritingError('PROJECT_FORBIDDEN', 403, 'הפרויקט אינו זמין בחשבון הזה.');
    return data as Record<string, unknown>;
}
export interface LocalProjectContext {
    project: {id: string; name: string};
    sources: Array<LetterSourceRef & {sourceId: string}>;
    unverified: Array<{documentId: string; reason: string}>;
    money: {scope: 'PROJECT'; baseNet: number | null; variations: IndividualPricingSummary};
    omittedCount: number;
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
async function savedLedgerRows(client: SupabaseClient, projectId: string): Promise<Record<string, unknown>[]> {
    const result: Record<string, unknown>[] = []; let expected: number | null = null;
    for (let start = 0; ; start += 1000) {
        const {data, error, count} = await client.from('pricing_ledger').select('*', {count: 'exact'})
            .eq('project_id', projectId).order('id').range(start, start + 999);
        if (error) throw error;
        if (!Array.isArray(data) || !Number.isSafeInteger(count) || count! < 0 || (expected !== null && expected !== count)
            || data.some(row => row.project_id !== projectId) || (data.length === 0 && start < count!)) {
            throw new LocalWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'לא הושלמה קריאה עקבית של התמחורים השמורים. יש לנסות שוב.');
        }
        expected = count; result.push(...data);
        if (result.length >= count!) break;
    }
    if (new Set(result.map(row => row.id)).size !== result.length || result.length !== expected) throw new LocalWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'קריאת התמחורים אינה מלאה.');
    return result;
}
/** Reads saved data only. A context excerpt never establishes contractual authority. */
export async function loadLocalProjectContext(client: SupabaseClient, projectId: string, userId: string, question: string): Promise<LocalProjectContext> {
    const project = await ownedLocalProject(client, projectId, userId);
    const [documents, rows] = await Promise.all([
        client.from('documents').select('id,project_id,title,extracted_text,parsed_json,ocr_status,storage_path,file_url,content_hash,created_at,deleted_at', {count: 'exact'})
            .eq('project_id', projectId).is('deleted_at', null).order('id').range(0, 199),
        savedLedgerRows(client, projectId),
    ]);
    if (documents.error) throw documents.error;
    if (!Array.isArray(documents.data) || !Number.isSafeInteger(documents.count) || documents.data.length !== Math.min(200, documents.count!)
        || documents.data.some(row => row.project_id !== projectId)) throw new LocalWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'קריאת המסמכים השמורים אינה מלאה.');
    const unverified: LocalProjectContext['unverified'] = [];
    const candidates = documents.data.flatMap(document => {
        const readiness = assessDocumentSourceReadiness(document);
        const label = document.title ? document.title + ' — ' : '';
        if (!readiness.canCompare) {
            const reasons = {UNREADABLE: 'לא נקרא תוכן מהימן', EXTRACTION_INCOMPLETE: 'קריאת המקור לא הושלמה', DRAFT: 'מסמך מסומן כטיוטה', FRAGMENT: 'המקור מסומן כקטע בלבד'};
            unverified.push({documentId: document.id, reason: label + (reasons[readiness.status as keyof typeof reasons] || 'מצב המקור דורש בדיקה')}); return [];
        }
        const selection = selectContractContext({id: document.id, extracted_text: document.extracted_text || ''}, question, 1200);
        if (selection.limitations.some(reason => reason !== 'no_subject_match')) unverified.push({documentId: document.id, reason: label + 'נבחר קטע מוגבל; יש לבדוק את ההקשר וההפניות המלאים'});
        return selection.source_anchors.map(anchor => ({document, anchor, score: selection.relevance_score || 0}));
    }).sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id));
    const sources: LocalProjectContext['sources'] = []; let characters = 0;
    for (const {document, anchor} of candidates) {
        if (sources.length >= 6 || characters + anchor.quote.length > 3600) continue;
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
        throw new LocalWritingError('LOCAL_CONTEXT_INCOMPLETE', 503, 'סכום הפרויקט גדול מטווח הדיוק הכספי שניתן לאמת. יש לבדוק את הנתונים השמורים.');
    }
    return {project: {id: projectId, name: typeof project.name === 'string' ? project.name : ''}, sources, unverified,
        money: {scope: 'PROJECT', baseNet, variations},
        omittedCount: Math.max(0, documents.count! - new Set([...sources.map(source => source.documentId), ...unverified.map(source => source.documentId)]).size)};
}
/** Model fields contain prose only; numbers and literal quotations come from saved data. */
export function checkedLocalProse(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 3000 || !/[א-ת]{2,}/u.test(value)
        || /[\p{N}₪$€£%"“”«»]|https?:|(?<![א-ת])(?:[בכלמה]?שקלים?|ש[״']?ח|אחוזים?)(?![א-ת])/iu.test(value)) throw localInvalidResponse();
    const words = value.match(/[א-ת]+/gu) || [];
    if (words.length >= 10 && new Set(words).size / words.length < .65) {
        const pairs = new Map<string, number>();
        for (let index = 1; index < words.length; index++) {
            const pair = words[index - 1] + ' ' + words[index], count = (pairs.get(pair) || 0) + 1;
            if (count >= 3) throw localInvalidResponse();
            pairs.set(pair, count);
        }
    }
    return value.trim();
}
export function checkedSourceIds(value: unknown, allowed: Set<string>): string[] {
    if (!Array.isArray(value) || value.length > allowed.size || value.some(id => typeof id !== 'string' || !allowed.has(id)) || new Set(value).size !== value.length) throw localInvalidResponse();
    return value;
}
export function parseLocalWritingObject(value: string, keys: string[]): Record<string, unknown> {
    try {const parsed: unknown = JSON.parse(value); if (!isRecord(parsed) || Object.keys(parsed).sort().join(',') !== [...keys].sort().join(',')) throw localInvalidResponse(); return parsed;}
    catch {throw localInvalidResponse();}
}
export const localMoney = (value: number | null) => value === null ? 'לא ידוע' : (value || 0).toFixed(2) + ' ₪';
export function renderLocalSources(sources: Array<LetterSourceRef & {sourceId?: string}>): string {
    return sources.map(source => source.basis === 'MANUAL' ? 'אישור ידני — דורש בדיקה: ' + source.manualNote
        : [source.sourceId ? '[' + source.sourceId + ']' : '', source.status === 'VERIFIED' ? 'ציטוט שנבדק בטקסט השמור; תחולה ותוקף דורשים בדיקה' : 'מקור שטרם אומת',
            source.title || 'מסמך', source.pageLabel ? 'עמוד ' + source.pageLabel : '', source.quote || 'לא נמצא ציטוט שניתן לאמת'].filter(Boolean).join(' · ')).join('\n');
}
