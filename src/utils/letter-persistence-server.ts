import type { SupabaseClient } from '@supabase/supabase-js';
import type { LetterDraftPreview, MarkLetterSentRequest, PreviewLetterRequest, SavedLetterResult, SaveLetterDraftRequest } from './letter-draft-types';

export type LetterHandler = (request: Request) => Promise<Response>;
const uuid = (value: unknown): value is string => typeof value === 'string'
    && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const docTypes = new Set(['claim', 'notice', 'vo_request', 'response', 'general', 'official_vo']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
class LetterHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const invalid = () => new LetterHttpError(400, 'LETTER_INVALID_INPUT', 'פרטי הבקשה אינם מלאים או אינם תקינים.');

function publicError(error: unknown) {
    if (error instanceof LetterHttpError) return json({ success: false, code: error.code, error: error.message }, error.status);
    const code = record(error) ? error.code : undefined;
    const failure = code === 'PT409' ? new LetterHttpError(409, 'LETTER_CONFLICT', 'הטיוטה או המקורות השתנו. יש לבדוק שוב את התמחורים לפני השמירה.')
        : code === 'PT422' ? new LetterHttpError(422, 'LETTER_NOT_READY', 'הסכומים או המקורות עדיין דורשים בדיקה.')
            : code === '42501' ? new LetterHttpError(403, 'LETTER_FORBIDDEN', 'המכתב או הפרויקט אינם זמינים בחשבון הזה.')
                : new LetterHttpError(500, 'LETTER_WRITE_FAILED', 'הפעולה לא הושלמה. הטקסט נשאר זמין לבדיקה ולניסיון חוזר.');
    return json({ success: false, code: failure.code, error: failure.message }, failure.status);
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
    if (Number(request.headers.get('content-length') || 0) > 1024 * 1024) throw invalid();
    try {
        const text = await request.text();
        if (text.length > 1024 * 1024) throw invalid();
        const body: unknown = JSON.parse(text);
        if (!record(body)) throw invalid();
        return body;
    } catch { throw invalid(); }
}
function previewInput(body: Record<string, unknown>): PreviewLetterRequest {
    if (!uuid(body.projectId) || typeof body.docType !== 'string' || !docTypes.has(body.docType)
        || !Array.isArray(body.itemIds) || !body.itemIds.length || !body.itemIds.every(uuid)) throw invalid();
    return { projectId: body.projectId, docType: body.docType, itemIds: body.itemIds };
}
function saveInput(body: Record<string, unknown>): SaveLetterDraftRequest {
    const preview = previewInput(body);
    if (!uuid(body.clientDraftId) || !uuid(body.operationId) || !Number.isSafeInteger(body.expectedRevision)
        || Number(body.expectedRevision) < 0 || typeof body.subject !== 'string' || !body.subject.trim()
        || typeof body.recipientName !== 'string' || typeof body.content !== 'string' || !body.content.trim()
        || !record(body.sourceRevisions) || Object.keys(body.sourceRevisions).length !== new Set(preview.itemIds).size
        || !preview.itemIds.every(id => typeof body.sourceRevisions === 'object' && body.sourceRevisions !== null
            && typeof (body.sourceRevisions as Record<string, unknown>)[id] === 'string'
            && /^[a-f\d]{64}$/i.test((body.sourceRevisions as Record<string, string>)[id]))) throw invalid();
    return { ...preview, clientDraftId: body.clientDraftId, operationId: body.operationId,
        expectedRevision: body.expectedRevision as number, subject: body.subject, recipientName: body.recipientName,
        content: body.content, sourceRevisions: body.sourceRevisions as Record<string, string> };
}
function sentInput(body: Record<string, unknown>): MarkLetterSentRequest {
    if (!uuid(body.projectId) || !uuid(body.letterId) || !uuid(body.operationId)
        || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) throw invalid();
    return { projectId: body.projectId, letterId: body.letterId, operationId: body.operationId, expectedRevision: body.expectedRevision as number };
}
async function requireOwner(client: SupabaseClient, projectId: string, userId: string) {
    const { data, error } = await client.from('projects').select('id').eq('id', projectId).eq('contractor_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new LetterHttpError(403, 'LETTER_FORBIDDEN', 'הפרויקט אינו זמין בחשבון הזה.');
}
async function rpcResult<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    if (!record(data)) throw new Error('Invalid letter transaction result');
    return data as T;
}
export function previewVoLetterDraft(client: SupabaseClient, input: PreviewLetterRequest): Promise<LetterDraftPreview> {
    return rpcResult(client, 'preview_letter_draft', { p_project_id: input.projectId, p_doc_type: input.docType, p_item_ids: input.itemIds });
}
export function persistVoLetterDraft(client: SupabaseClient, input: SaveLetterDraftRequest): Promise<SavedLetterResult> {
    return rpcResult(client, 'save_letter_draft', { p_project_id: input.projectId, p_client_draft_id: input.clientDraftId,
        p_expected_revision: input.expectedRevision, p_operation_id: input.operationId, p_subject: input.subject,
        p_recipient_name: input.recipientName, p_doc_type: input.docType, p_content: input.content,
        p_item_ids: input.itemIds, p_expected_sources: input.sourceRevisions });
}
export function markPersistedVoLetterSent(client: SupabaseClient, input: MarkLetterSentRequest): Promise<SavedLetterResult> {
    return rpcResult(client, 'mark_letter_sent', { p_project_id: input.projectId, p_letter_id: input.letterId,
        p_expected_revision: input.expectedRevision, p_operation_id: input.operationId });
}

export function createLetterHttpHandlers({ createClient }: { createClient: () => Promise<SupabaseClient> }): {
    preview: LetterHandler; save: LetterHandler; markSent: LetterHandler; delete: LetterHandler;
} {
    const handle = (operation: (client: SupabaseClient, userId: string, body: Record<string, unknown>) => Promise<Response>): LetterHandler => async request => {
        try {
            const client = await createClient();
            const { data: { user } } = await client.auth.getUser();
            if (!user) throw new LetterHttpError(401, 'UNAUTHORIZED', 'נדרשת כניסה למערכת.');
            return await operation(client, user.id, await bodyOf(request));
        } catch (error) { return publicError(error); }
    };
    return {
        preview: handle(async (client, userId, body) => {
            const input = previewInput(body); await requireOwner(client, input.projectId, userId);
            return json({ success: true, ...await previewVoLetterDraft(client, input) });
        }),
        save: handle(async (client, userId, body) => {
            const input = saveInput(body); await requireOwner(client, input.projectId, userId);
            return json({ success: true, ...await persistVoLetterDraft(client, input) });
        }),
        markSent: handle(async (client, userId, body) => {
            const input = sentInput(body); await requireOwner(client, input.projectId, userId);
            return json({ success: true, ...await markPersistedVoLetterSent(client, input) });
        }),
        delete: handle(async (client, userId, body) => {
            if (!uuid(body.letterId)) throw invalid();
            const { data: letter, error } = await client.from('vo_letters').select('id, project_id').eq('id', body.letterId).maybeSingle();
            if (error) throw error;
            if (!letter) throw new LetterHttpError(404, 'LETTER_NOT_FOUND', 'המכתב אינו זמין בחשבון הזה.');
            await requireOwner(client, letter.project_id, userId);
            const { data: removed, error: deleteError } = await client.from('vo_letters').delete().eq('id', letter.id).eq('project_id', letter.project_id).select('id');
            if (deleteError) throw deleteError;
            if (!removed?.length) throw new LetterHttpError(404, 'LETTER_NOT_FOUND', 'המכתב אינו זמין בחשבון הזה.');
            return json({ success: true, deletedId: letter.id });
        }),
    };
}
