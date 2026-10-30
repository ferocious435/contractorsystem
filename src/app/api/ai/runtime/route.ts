import {getRuntimeService} from '@/server/ai/runtime.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>getRuntimeService().get(request);
export const POST=(request:Request)=>getRuntimeService().post(request);
