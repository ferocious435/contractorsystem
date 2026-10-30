import {getRuntimeService} from '@/server/ai/runtime.server';

export const dynamic = 'force-dynamic';

export const GET=(request:Request)=>getRuntimeService().get(request);
