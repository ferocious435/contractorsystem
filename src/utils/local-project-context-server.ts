import {checkOllamaRuntime} from '@/lib/ollama';
import {isOllamaProvider} from './ai-readiness';
import type {LetterSourceRef} from './letter-draft-types';
import {isRecord} from './letter-snapshot';

import {ProjectWritingError as LocalWritingError} from './project-writing-context-server';
export {ProjectWritingError as LocalWritingError,ownedWritingProject as ownedLocalProject,loadProjectWritingContext as loadLocalProjectContext} from './project-writing-context-server';
export type {ProjectWritingContext as LocalProjectContext} from './project-writing-context-server';
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
