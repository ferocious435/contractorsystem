import {getRuntimeService} from '@/server/ai/runtime.server';
import {createClient} from '@/utils/supabase/server';
import {checkOllamaRuntime} from '@/lib/ollama';
import {getAiReadiness} from '@/utils/ai-readiness';

export const dynamic = 'force-dynamic';

export async function GET(request:Request):Promise<Response>{
    const action=new URL(request.url).searchParams.get('action');
    if(action&&['scan','scan_preview','pricing','work_change','support_enrichment'].includes(action)){
        const client=await createClient(),{data:{user}}=await client.auth.getUser();
        if(!user)return Response.json({available:false,provider:'Local AI',reason:'AI_LOGIN_REQUIRED'},{status:401});
        const state=getAiReadiness(process.env,await checkOllamaRuntime());
        return Response.json(state,{headers:{'Cache-Control':'no-store'}});
    }
    return getRuntimeService().get(request);
}
