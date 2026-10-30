import {getAiJobService} from '@/server/ai/service.server';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{jobId:string}>}){
    return getAiJobService().cancelRequest(request,(await context.params).jobId);
}
