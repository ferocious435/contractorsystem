import 'server-only';
import {createHash} from 'node:crypto';
import {createAdminClient} from '@/utils/supabase/admin';
import {BusinessAiError,record,validUuid,type AiJobKind,type AiJobState,type JobDto,type JsonObject,type JsonValue,type PreparedAiResult,type RuntimeProfile} from './contracts';

const kinds=new Set(['letter','consultant','scan','scan_preview','pricing','work_change','support_enrichment','document_analysis']);
const states=new Set(['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED']);
interface RpcTransport {rpc(name:string,params:{p:JsonObject}):PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>;}
export interface AiJobRecord extends JobDto {
    ownerId:string;payload:JsonObject;profile:RuntimeProfile;requestKey:string;inputHash:string;
    contextSnapshot:JsonObject;leaseToken:string;leaseExpiresAt:string;attempt:number;
}
/** Canonical input identity includes the manually saved profile and form correlation. */
function canonical(value:unknown):string {
    if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
    if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(record(value)&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
    throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
}
function dto(value:unknown):JobDto {
    if(!record(value)||!validUuid(value.id)||!validUuid(value.project_id)||!kinds.has(String(value.kind))||!states.has(String(value.state))||!Number.isSafeInteger(value.revision))throw new BusinessAiError('AI_JOB_INVALID');
    return {id:value.id,projectId:value.project_id,kind:value.kind as AiJobKind,state:value.state as AiJobState,revision:Number(value.revision),
        conversationId:typeof value.conversation_id==='string'?value.conversation_id:null,clientContextId:typeof value.client_context_id==='string'?value.client_context_id:null,
        result:(value.result??null) as JsonValue,error:record(value.error)&&typeof value.error.code==='string'&&typeof value.error.message==='string'?{code:value.error.code,message:value.error.message}:null};
}
function ids(...values:unknown[]){if(values.some(value=>!validUuid(value)))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);}
const safeError='העוזר לא השלים את הפעולה. הנתונים נשמרו.';
export function createAiJobStore(transport:RpcTransport) {
    async function rpc(name:string,p:JsonObject):Promise<unknown>{
        let response;try{response=await transport.rpc('contractor_ai_'+name,{p});}catch{throw new BusinessAiError('AI_UNAVAILABLE');}
        if(response.error){const code=response.error.message?.match(/\bAI_[A-Z_]+\b/)?.[0]??'AI_UNAVAILABLE';
            const status=code==='AI_ACCESS_DENIED'?403:/(?:CONFLICT|CHANGED|LEASE_LOST)$/.test(code)?409:code.endsWith('_INVALID')?400:503;
            throw new BusinessAiError(code,safeError,status);}
        return response.data;
    }
    async function enqueue(ownerId:string,projectId:string,kind:AiJobKind,payload:JsonObject,requestKey:string,profile:RuntimeProfile,context:{conversationId?:string|null;clientContextId?:string|null}={}):Promise<JobDto>{
        ids(ownerId,projectId);if(!kinds.has(kind)||typeof requestKey!=='string'||!requestKey.trim()||requestKey.length>128||!record(payload))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        if(!record(profile)||profile.ownerId!==ownerId||typeof profile.model!=='string'||!profile.model||!Number.isSafeInteger(profile.revision)||profile.revision<1||!/^[a-f\d]{64}$/.test(profile.accountFingerprint))throw new BusinessAiError('AI_PROFILE_INVALID',undefined,400);
        const correlation={conversationId:context.conversationId??null,clientContextId:context.clientContextId??null};for(const value of Object.values(correlation))if(value!==null)ids(value);
        const serialized=canonical({kind,payload,profile,context:correlation});if(Buffer.byteLength(serialized)>1024*1024)throw new BusinessAiError('AI_INPUT_INVALID',undefined,413);
        return dto(await rpc('enqueue',{ownerId,projectId,kind,payload,requestKey,profile:profile as unknown as JsonObject,...correlation,inputHash:createHash('sha256').update(serialized).digest('hex')}));
    }
    async function claim(workerId:string,now:number):Promise<AiJobRecord|null>{
        if(typeof workerId!=='string'||!workerId||workerId.length>128||!Number.isFinite(now))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const row=await rpc('claim',{workerId,now:new Date(now).toISOString()});if(row===null)return null;
        if(!record(row)||!validUuid(row.owner_id)||!validUuid(row.lease_token)||!record(row.payload)||!record(row.profile_snapshot)||!record(row.context_snapshot))throw new BusinessAiError('AI_JOB_INVALID');
        return {...dto(row),ownerId:row.owner_id,payload:row.payload as JsonObject,profile:row.profile_snapshot as unknown as RuntimeProfile,requestKey:String(row.request_key),inputHash:String(row.input_hash),contextSnapshot:row.context_snapshot as JsonObject,leaseToken:row.lease_token,leaseExpiresAt:String(row.lease_expires_at),attempt:Number(row.attempt)};
    }
    async function heartbeat(id:string,leaseToken:string):Promise<void>{ids(id,leaseToken);if(await rpc('heartbeat',{id,leaseToken})!==true)throw new BusinessAiError('AI_LEASE_LOST',undefined,409);}
    async function complete(id:string,leaseToken:string,prepared:PreparedAiResult):Promise<boolean>{ids(id,leaseToken);canonical(prepared);return await rpc('complete',{id,leaseToken,result:prepared.result,effects:prepared.effects as unknown as JsonValue})===true;}
    async function fail(id:string,leaseToken:string,error:{code:string;message:string}):Promise<boolean>{ids(id,leaseToken);return await rpc('fail',{id,leaseToken,error:{code:/^AI_[A-Z_]{1,60}$/.test(error.code)?error.code:'AI_FAILED',message:safeError}})===true;}
    async function cancel(ownerId:string,id:string,expectedRevision:number):Promise<JobDto>{ids(ownerId,id);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return dto(await rpc('cancel',{ownerId,id,expectedRevision}));}
    async function interruptStale(now:number,pendingBefore?:number):Promise<number>{if(!Number.isFinite(now)||(pendingBefore!==undefined&&!Number.isFinite(pendingBefore)))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return Number(await rpc('interrupt_stale',{now:new Date(now).toISOString(),...(pendingBefore===undefined?{}:{pendingBefore:new Date(pendingBefore).toISOString()})}));}
    async function readOwned(ownerId:string,projectId:string,id:string):Promise<JobDto|null>{ids(ownerId,projectId,id);const row=await rpc('read',{ownerId,projectId,id});return row===null?null:dto(row);}
    async function listOwned(ownerId:string,projectId:string,kind:AiJobKind,clientContextId?:string):Promise<JobDto[]>{ids(ownerId,projectId);if(!kinds.has(kind))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);if(clientContextId!==undefined)ids(clientContextId);const rows=await rpc('list',{ownerId,projectId,kind,clientContextId:clientContextId??null});if(!Array.isArray(rows))throw new BusinessAiError('AI_JOB_INVALID');return rows.map(dto);}
    async function sourceRevision(projectId:string,type:string,targetId:string):Promise<string>{ids(projectId,targetId);if(!['SCAN_FINDING','SCAN_STATE','PRICING_EVIDENCE','DOCUMENT_ANALYSIS'].includes(type))throw new BusinessAiError('AI_EFFECT_INVALID',undefined,400);const value=await rpc('source_revision',{projectId,type,targetId});if(typeof value!=='string')throw new BusinessAiError('AI_JOB_INVALID');return value;}
    return {enqueue,claim,heartbeat,complete,fail,cancel,interruptStale,readOwned,listOwned,sourceRevision};
}
export type AiJobStore=ReturnType<typeof createAiJobStore>;
let shared:AiJobStore|undefined;
export function getAiJobStore():AiJobStore{return shared??=createAiJobStore(createAdminClient());}
