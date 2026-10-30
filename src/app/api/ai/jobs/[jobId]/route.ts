import {getOwnedAiJob} from '@/server/ai/service.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{jobId:string}>}){return getOwnedAiJob(request,(await context.params).jobId);}
