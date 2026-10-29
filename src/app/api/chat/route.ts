import {createClient} from '@/utils/supabase/server';
import {answerLocalConsultant} from '@/utils/local-consultant-server';
import {loadLocalProjectContext, isLocalUuid, localInvalidInput, localRequestBody, localWritingFailure, requireLocalWritingRuntime, LocalWritingError} from '@/utils/local-project-context-server';
import {isRecord} from '@/utils/letter-snapshot';

export async function POST(request: Request): Promise<Response> {
    try {
        const client = await createClient(), {data: {user}} = await client.auth.getUser();
        if (!user) throw new LocalWritingError('UNAUTHORIZED', 401, 'נדרשת כניסה למערכת.');
        const body = await localRequestBody(request);
        if (!isLocalUuid(body.projectId) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100
            || body.messages.some(message => !isRecord(message) || !['user', 'assistant'].includes(String(message.role))
                || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 8000)
            || body.messages.at(-1)?.role !== 'user') throw localInvalidInput();
        const messages = body.messages as Array<{role: 'user' | 'assistant'; content: string}>;
        const context = await loadLocalProjectContext(client, body.projectId, user.id, messages.at(-1)!.content);
        await requireLocalWritingRuntime();
        const result = await answerLocalConsultant({context, messages});
        return Response.json({success: true, ...result}, {headers: {'Cache-Control': 'no-store'}});
    } catch (error) {return localWritingFailure(error);}
}
