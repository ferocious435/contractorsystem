import {NextResponse} from 'next/server';
import {createClient} from '@/utils/supabase/server';
import {authenticateRuntimeOwner,createOwnedAiJob,getAiJobService,readAiRequest} from '@/server/ai/service.server';
import {BusinessAiError,record,validUuid} from '@/server/ai/contracts';
import {loadPricingScopeContext} from '@/utils/pricing-scope-sources-server';
import {pricingScopeSignature} from '@/utils/pricing-scope-signature';
import {loadWorkChangePacket,workChangePacketSignature} from '@/utils/work-change-review-server';
export const dynamic='force-dynamic';
function failure(error:unknown){const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return NextResponse.json({success:false,code:known.code,error:known.message},{status:known.status});}
export async function POST(request:Request){try{
    await authenticateRuntimeOwner(request);const raw=await readAiRequest(request);
    if(raw.reviewCaseOnly!==undefined&&typeof raw.reviewCaseOnly!=='boolean')throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    const {reviewCaseOnly,...payload}=raw;return createOwnedAiJob(request,reviewCaseOnly===true?'work_change':'pricing',payload);
}catch(error){return failure(error);}}
/** Opening a screen only restores a checked result for the current sources. */
export async function GET(request:Request){try{
    await authenticateRuntimeOwner(request);const params=new URL(request.url).searchParams,projectId=params.get('projectId'),findingId=params.get('contradictionId'),kind=params.get('reviewCaseOnly')==='true'?'work_change':'pricing';
    if(!validUuid(projectId)||!validUuid(findingId))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    const response=await getAiJobService().list(new Request(new URL('/api/ai/jobs?'+new URLSearchParams({projectId,kind,clientContextId:findingId}),request.url),{headers:request.headers}));
    if(!response.ok)return response;const body=await response.json(),jobs=Array.isArray(body.jobs)?body.jobs:[],client=await createClient();
    const signature=kind==='pricing'?pricingScopeSignature(await loadPricingScopeContext({supabase:client,projectId,findingId})):workChangePacketSignature(await loadWorkChangePacket(client,projectId,findingId));
    const saved=jobs.find((job:{state:string;result:unknown})=>job.state==='SUCCEEDED'&&record(job.result)&&(kind==='pricing'?job.result.scope_source_signature:job.result.sourceSignature)===signature);
    return NextResponse.json({success:true,result:saved?.result??null,job:jobs[0]??null,stale:jobs.some((job:{state:string})=>job.state==='SUCCEEDED')&&!saved},{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
