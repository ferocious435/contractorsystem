import {createClient} from '@/utils/supabase/server';
import {previewVoLetterDraft} from '@/utils/letter-persistence-server';
import {generateLocalLetter} from '@/utils/local-letter-server';
import {isLocalUuid, localInvalidInput, localRequestBody, localWritingFailure, ownedLocalProject, requireLocalWritingRuntime, LocalWritingError} from '@/utils/local-project-context-server';
import type {GenerateSmartLetterPayload} from '@/components/features/smart-letter/types';

export async function POST(request: Request): Promise<Response> {
    try {
        const client = await createClient(), {data: {user}} = await client.auth.getUser();
        if (!user) throw new LocalWritingError('UNAUTHORIZED', 401, 'נדרשת כניסה למערכת.');
        const body = await localRequestBody(request);
        if (!isLocalUuid(body.projectId) || !['claim', 'notice', 'vo_request', 'response', 'general', 'official_vo'].includes(String(body.letterType))
            || !Array.isArray(body.itemIds) || !body.itemIds.length || body.itemIds.length > 100 || !body.itemIds.every(isLocalUuid)
            || !['recipient', 'subject', 'keyPoints', 'tone'].every(key => typeof body[key] === 'string')
            || !['professional', 'formal', 'firm', 'aggressive', 'friendly', 'skeleton'].includes(String(body.tone))) throw localInvalidInput();
        const project = await ownedLocalProject(client, body.projectId, user.id);
        const payload: GenerateSmartLetterPayload = {projectId: body.projectId, letterType: body.letterType as string,
            itemIds: body.itemIds, recipient: body.recipient as string, subject: body.subject as string, keyPoints: body.keyPoints as string, tone: body.tone as string};
        const preview = await previewVoLetterDraft(client, {projectId: payload.projectId, docType: payload.letterType, itemIds: payload.itemIds});
        await requireLocalWritingRuntime();
        const result = await generateLocalLetter({payload, projectName: typeof project.name === 'string' ? project.name : '', preview});
        return Response.json({success: true, ...result}, {headers: {'Cache-Control': 'no-store'}});
    } catch (error) {return localWritingFailure(error);}
}
