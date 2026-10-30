import {NextResponse} from 'next/server';
import {authenticateRuntimeOwner,createOwnedAiJob,readAiRequest} from '@/server/ai/service.server';
import {BusinessAiError} from '@/server/ai/contracts';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{await authenticateRuntimeOwner(request);return createOwnedAiJob(request,'support_enrichment',await readAiRequest(request));}
catch(error){const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return NextResponse.json({success:false,code:known.code,error:known.message},{status:known.status});}}
