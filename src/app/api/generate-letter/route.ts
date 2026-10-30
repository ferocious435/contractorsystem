import {createOwnedAiJobFromRequest} from '@/server/ai/service.server';

export const POST = (request: Request): Promise<Response> => createOwnedAiJobFromRequest(request, 'letter');
