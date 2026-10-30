import {createOwnedAiJobFromRequest} from '@/server/ai/service.server';
export const dynamic='force-dynamic';
/** Only an owned saved job is accepted here. Reading and analysis run in its worker. */
export const POST=(request:Request)=>createOwnedAiJobFromRequest(request,'document_analysis');
