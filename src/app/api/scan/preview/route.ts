import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/utils/supabase/server';
import {authenticateRuntimeOwner,createOwnedAiJob,getAiJobService,readAiRequest} from '@/server/ai/service.server';
import {findOwnedRadarPreview,loadRadarPreview} from '@/server/ai/radar-preview.server';
import {BusinessAiError,record} from '@/server/ai/contracts';
export const maxDuration=300;
export const dynamic='force-dynamic';
function failure(error:unknown){const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return NextResponse.json({success:false,readOnly:true,databaseChanged:false,code:known.code,error:known.message},{status:known.status});}
/** Source diagnostics and previously saved answers only. Opening this URL never generates. */
export async function GET(request:NextRequest){try{
    const ownerId=await authenticateRuntimeOwner(request),client=await createClient();
    const {finding,findingRef}=await findOwnedRadarPreview(client,ownerId,new URL(request.url).searchParams.get('findingRef')||'');
    const current=await loadRadarPreview(client,finding.project_id,finding.id,findingRef);
    const url=new URL('/api/ai/jobs?'+new URLSearchParams({projectId:finding.project_id,kind:'scan_preview',clientContextId:finding.id}),request.url);
    const response=await getAiJobService().list(new Request(url,{headers:request.headers}));
    const payload=response.ok?await response.json():null,jobs=Array.isArray(payload?.jobs)?payload.jobs:[];
    const saved=jobs.find((job:{state:string;result:unknown})=>job.state==='SUCCEEDED'&&record(job.result)&&job.result.sourceSignature===current.sourceSignature);
    return NextResponse.json({...current.diagnostics,...(record(saved?.result)?saved.result:{}),job:jobs[0]||null,stale:jobs.some((job:{state:string})=>job.state==='SUCCEEDED')&&!saved},{headers:{'Cache-Control':'no-store'}});
}catch(error){return failure(error);}}
export async function POST(request:NextRequest){try{
    await authenticateRuntimeOwner(request);
    return createOwnedAiJob(request,'scan_preview',await readAiRequest(request));
}catch(error){return failure(error);}}
