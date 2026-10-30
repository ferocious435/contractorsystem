import 'server-only';
import {createClient} from '@/utils/supabase/server';
import {createAdminClient} from '@/utils/supabase/admin';
import {BusinessAiError,record,validUuid,type AiJobHandler,type AiJobKind,type JsonObject,type RuntimeProfile} from './contracts';
import {resolveRuntimeOwner} from './owner.server';
import {readRuntimeProfile} from './profile.server';
import {getAiJobStore,type AiJobStore} from './jobs.server';
import {getAiWorker,type AiWorker} from './worker.server';
import {getAiHandler} from './handlers/index';
interface ServiceOptions {store:AiJobStore;worker:AiWorker;authenticate:(request:Request)=>Promise<{id:string}|null>;resolveOwner:()=>Promise<string>;ownsProject:(ownerId:string,projectId:string)=>Promise<boolean>;readProfile:(ownerId:string)=>Promise<RuntimeProfile|null>;handlerFor:(kind:AiJobKind)=>AiJobHandler|null;}
const kinds=new Set(['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis']);
const forbidden=new Set(['prompt','threadId','turnId','ownerId','profile','model','effort','instructions','systemPrompt']);
const headers={'Cache-Control':'no-store'};
function failure(error:unknown):Response {const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return Response.json({success:false,code:known.code,error:known.message},{status:known.status,headers});}
export async function readAiRequest(request:Request):Promise<JsonObject>{
    const reader=request.body?.getReader();if(!reader)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);let size=0;const parts:Uint8Array[]=[];
    try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1024*1024){await reader.cancel();throw new BusinessAiError('AI_INPUT_INVALID',undefined,413);}parts.push(next.value);}}finally{reader.releaseLock();}
    let body:unknown;try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);}
    if(!record(body))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return body as JsonObject;
}
export function createAiJobService(options:ServiceOptions) {
    async function owner(request:Request):Promise<string>{const user=await options.authenticate(request);if(!user)throw new BusinessAiError('AI_UNAUTHORIZED','Нужно войти в программу.',401);const owner=await options.resolveOwner();if(user.id!==owner)throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);return owner;}
    async function project(ownerId:string,projectId:unknown):Promise<string>{if(!validUuid(projectId))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);if(!await options.ownsProject(ownerId,projectId))throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);return projectId;}
    async function createAuthorized(ownerId:string,kind:AiJobKind,raw:unknown):Promise<Response>{
        if(!record(raw)||Object.keys(raw).some(key=>forbidden.has(key))||typeof raw.requestKey!=='string'||!raw.requestKey.trim()||raw.requestKey.length>128)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const projectId=await project(ownerId,raw.projectId),handler=options.handlerFor(kind);if(!handler)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const context={conversationId:raw.conversationId??null,clientContextId:raw.clientContextId??null};for(const value of Object.values(context))if(value!==null&&!validUuid(value))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        if(kind==='consultant'&&(!context.conversationId||context.clientContextId!==context.conversationId))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        if(kind==='scan_preview'&&context.clientContextId!==raw.findingId)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        if(kind==='scan'&&context.clientContextId!==(raw.workDocId||raw.retryDocumentId||null))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        if((kind==='pricing'||kind==='work_change')&&context.clientContextId!==raw.contradictionId)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const business=Object.fromEntries(Object.entries(raw).filter(([key])=>!['projectId','requestKey','conversationId','clientContextId'].includes(key)));
        let payload:JsonObject;try{payload=handler.validate(business);}catch{throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);}
        const profile=await options.readProfile(ownerId);if(!profile)throw new BusinessAiError('AI_PROFILE_REQUIRED');if(profile.ownerId!==ownerId)throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);
        await options.worker.initialize();
        const job=await options.store.enqueue(ownerId,projectId,kind,payload,raw.requestKey,profile,context as {conversationId:string|null;clientContextId:string|null});
        void options.worker.run().catch(()=>{});return Response.json({success:true,job},{status:202,headers});
    }
    async function create(request:Request,kind:AiJobKind,payload:unknown):Promise<Response>{try{return await createAuthorized(await owner(request),kind,payload);}catch(error){return failure(error);}}
    async function createRequest(request:Request,kind:AiJobKind):Promise<Response>{try{const ownerId=await owner(request);return await createAuthorized(ownerId,kind,await readAiRequest(request));}catch(error){return failure(error);}}
    async function post(request:Request):Promise<Response>{try{const ownerId=await owner(request),raw=await readAiRequest(request);if(Object.keys(raw).some(key=>!['kind','projectId','requestKey','payload','conversationId','clientContextId'].includes(key))||!kinds.has(String(raw.kind))||!record(raw.payload)||Object.keys(raw.payload).some(key=>['projectId','requestKey','conversationId','clientContextId'].includes(key)))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        return await createAuthorized(ownerId,raw.kind as AiJobKind,{...raw.payload,projectId:raw.projectId,requestKey:raw.requestKey,conversationId:raw.conversationId??null,clientContextId:raw.clientContextId??null});}catch(error){return failure(error);}}
    async function read(request:Request,id:string):Promise<Response>{try{const ownerId=await owner(request),projectId=await project(ownerId,new URL(request.url).searchParams.get('projectId'));if(!validUuid(id))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);await options.worker.initialize();await options.store.interruptStale(Date.now());const job=await options.store.readOwned(ownerId,projectId,id);if(!job)throw new BusinessAiError('AI_JOB_NOT_FOUND',undefined,404);return Response.json({success:true,job},{headers});}catch(error){return failure(error);}}
    async function list(request:Request):Promise<Response>{try{const ownerId=await owner(request),params=new URL(request.url).searchParams,projectId=await project(ownerId,params.get('projectId')),kind=params.get('kind'),context=params.get('clientContextId')??undefined;
        if(!kinds.has(String(kind))||(context!==undefined&&!validUuid(context)))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);await options.worker.initialize();await options.store.interruptStale(Date.now());return Response.json({success:true,jobs:await options.store.listOwned(ownerId,projectId,kind as AiJobKind,context)},{headers});}catch(error){return failure(error);}}
    async function cancelAuthorized(request:Request,ownerId:string,id:string,revision:number):Promise<Response>{const projectId=await project(ownerId,new URL(request.url).searchParams.get('projectId'));if(!validUuid(id))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);const current=await options.store.readOwned(ownerId,projectId,id);if(!current)throw new BusinessAiError('AI_JOB_NOT_FOUND',undefined,404);const job=await options.store.cancel(ownerId,id,revision);options.worker.abort(id);return Response.json({success:true,job},{headers});}
    async function cancel(request:Request,id:string,revision:number):Promise<Response>{try{return await cancelAuthorized(request,await owner(request),id,revision);}catch(error){return failure(error);}}
    async function cancelRequest(request:Request,id:string):Promise<Response>{try{const ownerId=await owner(request),body=await readAiRequest(request);if(Object.keys(body).some(key=>key!=='expectedRevision')||!Number.isSafeInteger(body.expectedRevision))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return await cancelAuthorized(request,ownerId,id,Number(body.expectedRevision));}catch(error){return failure(error);}}
    return {create,createRequest,post,read,list,cancel,cancelRequest};
}
export async function authenticateRuntimeOwner(request:Request):Promise<string>{
    void request;const client=await createClient(),{data:{user},error}=await client.auth.getUser();if(error||!user)throw new BusinessAiError('AI_UNAUTHORIZED','Нужно войти в программу.',401);
    const owner=await resolveRuntimeOwner(createAdminClient());if(user.id!==owner)throw new BusinessAiError('AI_ACCESS_DENIED',undefined,403);return owner;
}
let shared:ReturnType<typeof createAiJobService>|undefined;
export function getAiJobService(){return shared??=createAiJobService({store:getAiJobStore(),worker:getAiWorker(),authenticate:async request=>({id:await authenticateRuntimeOwner(request)}),resolveOwner:()=>resolveRuntimeOwner(createAdminClient()),
    ownsProject:async(owner,project)=>{const result=await createAdminClient().from('projects').select('id').eq('id',project).eq('contractor_id',owner).maybeSingle();if(result.error)throw new BusinessAiError('AI_UNAVAILABLE');return Boolean(result.data);},readProfile:readRuntimeProfile,handlerFor:getAiHandler});}
export const createOwnedAiJob=(request:Request,kind:AiJobKind,payload:unknown):Promise<Response>=>getAiJobService().create(request,kind,payload);
export const createOwnedAiJobFromRequest=(request:Request,kind:AiJobKind):Promise<Response>=>getAiJobService().createRequest(request,kind);
export const getOwnedAiJob=(request:Request,id:string):Promise<Response>=>getAiJobService().read(request,id);
export const cancelOwnedAiJob=(request:Request,id:string,revision:number):Promise<Response>=>getAiJobService().cancel(request,id,revision);
