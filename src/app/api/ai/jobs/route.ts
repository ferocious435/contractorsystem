import {getAiJobService} from '@/server/ai/service.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const POST=(request:Request)=>getAiJobService().post(request);
export const GET=(request:Request)=>getAiJobService().list(request);
