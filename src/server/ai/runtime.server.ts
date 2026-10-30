import 'server-only';
import {BusinessAiError,record,type RuntimeDescriptor,type RuntimeModel,type AiJobKind,type RuntimeProfile} from './contracts';
import {accountFingerprint} from './owner.server';
import {getCodexClient,type CodexClient} from './codex-client.server';
import {inspectRuntimeProfile,readRuntimeProfile,saveRuntimeProfile} from './profile.server';
import {authenticateRuntimeOwner,readAiRequest} from './service.server';
import {registeredAiKinds} from './handlers/index';
import {getCodexReadiness} from '@/utils/ai-readiness';
interface Profiles {read(owner:string):Promise<RuntimeProfile|null>;inspect(owner:string):Promise<RuntimeProfile|null>;save(owner:string,selection:unknown,revision:number):Promise<RuntimeProfile>;}
interface Options {authenticate:(request:Request)=>Promise<string>;client:Pick<CodexClient,'request'|'startLogin'>;profiles:Profiles;kinds:()=>AiJobKind[];}
const headers={'Cache-Control':'no-store'};
function failure(error:unknown){const code=error instanceof BusinessAiError?error.code:record(error)&&typeof error.code==='string'?error.code:'AI_UNAVAILABLE';const status=error instanceof BusinessAiError?error.status:code==='AI_ACCESS_DENIED'?403:code==='AI_UNAUTHORIZED'?401:503;return Response.json({success:false,code,error:'Не удалось получить настройки помощника. Повторите попытку.'},{status,headers});}
function modelChoices(data:unknown):RuntimeModel[]{if(!Array.isArray(data))throw new BusinessAiError('AI_UNAVAILABLE');return data.filter(record).filter(model=>typeof model.model==='string'&&model.hidden!==true).map(model=>({
    model:String(model.model),displayName:typeof model.displayName==='string'?model.displayName:String(model.model),images:Array.isArray(model.inputModalities)&&model.inputModalities.includes('image'),
    efforts:Array.isArray(model.supportedReasoningEfforts)?model.supportedReasoningEfforts.filter(record).filter(e=>typeof e.reasoningEffort==='string').map(e=>({value:String(e.reasoningEffort),description:typeof e.description==='string'?e.description:String(e.reasoningEffort)})):[]
}));}
export function createRuntimeService(options:Options){
    async function descriptor(owner:string):Promise<RuntimeDescriptor>{
        const response=await options.client.request<Record<string,unknown>>('account/read',{refreshToken:false});let authenticated=false;try{accountFingerprint(response.account);authenticated=true;}catch{}
        const kinds=options.kinds(),stored=await options.profiles.inspect(owner),profile=stored?{model:stored.model,effort:stored.effort,revision:stored.revision}:null;
        if(!authenticated)return {provider:'Codex',authenticated:false,configured:false,available:false,reason:'AI_LOGIN_REQUIRED',profile,models:[],kinds};
        const catalog=await options.client.request<Record<string,unknown>>('model/list',{includeHidden:false,limit:100});const models=modelChoices(catalog.data);
        let configured=false,reason:string|null='AI_PROFILE_REQUIRED';try{configured=Boolean(await options.profiles.read(owner));if(configured)reason=null;}catch(error){reason=error instanceof BusinessAiError?error.code:'AI_UNAVAILABLE';}
        const readiness=getCodexReadiness({authenticated:true,configured,kinds,reason});
        return {...readiness,provider:'Codex',authenticated:true,configured,profile,models,kinds};
    }
    async function get(request:Request){try{return Response.json({success:true,...await descriptor(await options.authenticate(request))},{headers});}catch(error){return failure(error);}}
    async function post(request:Request){try{const owner=await options.authenticate(request),body=await readAiRequest(request);
        if(body.operation==='login'){if(Object.keys(body).some(key=>key!=='operation'))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);return Response.json({success:true,authUrl:(await options.client.startLogin()).authUrl},{headers});}
        if(body.operation!=='save'||Object.keys(body).some(key=>!['operation','selection','expectedRevision'].includes(key))||!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0)throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        // Validate the public shape before any metadata read, including rejecting credential fields.
        if(!record(body.selection)||Object.keys(body.selection).some(key=>!['model','effort'].includes(key))||typeof body.selection.model!=='string'||(body.selection.effort!==null&&typeof body.selection.effort!=='string'))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
        const saved=await options.profiles.save(owner,body.selection,Number(body.expectedRevision));return Response.json({success:true,profile:{model:saved.model,effort:saved.effort,revision:saved.revision}},{headers});
    }catch(error){return failure(error);}}
    return {get,post,descriptor};
}
let shared:ReturnType<typeof createRuntimeService>|undefined;
export function getRuntimeService(){return shared??=createRuntimeService({authenticate:authenticateRuntimeOwner,client:getCodexClient(),profiles:{read:readRuntimeProfile,save:saveRuntimeProfile,inspect:inspectRuntimeProfile},kinds:registeredAiKinds});}
