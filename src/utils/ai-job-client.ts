import {BusinessAiError,record,validUuid,type AiJobKind,type JobDto,type JsonValue} from '@/server/ai/contracts';
const terminal=new Set(['SUCCEEDED','FAILED','CANCELLED','INTERRUPTED']);
const states=new Set(['QUEUED','RUNNING',...terminal]);
interface Observer {signal?:AbortSignal;projectId?:string;onProgress?:(job:JobDto)=>void;}
export interface AiEditorContext {projectId:string;kind:AiJobKind;clientContextId:string|null;ticket:number;editorRevision:number;}
export function canApplyAiResult(job:JobDto,started:AiEditorContext,current:AiEditorContext):boolean{return job.projectId===current.projectId&&job.kind===current.kind&&job.clientContextId===current.clientContextId&&started.projectId===current.projectId&&started.kind===current.kind&&started.clientContextId===current.clientContextId&&started.ticket===current.ticket&&started.editorRevision===current.editorRevision;}
function wait(ms:number,signal?:AbortSignal):Promise<void>{return new Promise((resolve,reject)=>{if(signal?.aborted){reject(signal.reason);return;}const timer=setTimeout(done,ms);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);}signal?.addEventListener('abort',abort,{once:true});});}
export function createAiJobClient({fetchImpl=fetch,sleep=wait}:{fetchImpl?:typeof fetch;sleep?:(ms:number,signal?:AbortSignal)=>Promise<unknown>}={}){
    const projects=new Map<string,string>();
    async function request(url:string,options:RequestInit={}):Promise<Record<string,unknown>>{
        const deadline=AbortSignal.timeout(15000),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
        try{const response=await fetchImpl(url,{cache:'no-store',...options,signal});let value:unknown;
            try{value=await response.json();}catch(error){if(signal.aborted)throw error;throw new BusinessAiError('AI_RESPONSE_INVALID');}
            if(!response.ok||!record(value)||value.success!==true){const code=record(value)&&typeof value.code==='string'?value.code:'AI_UNAVAILABLE';throw new BusinessAiError(code,'הפעולה לא הושלמה. הנתונים נשמרו.',response.status||503);}return value;
        }catch(error){if(deadline.aborted&&!options.signal?.aborted)throw new BusinessAiError('AI_TIMEOUT','לא התקבל אישור בזמן. הנתונים נשמרו; אפשר לבדוק שוב את מצב הפעולה.',408);throw error;}
    }
    function checked(value:unknown,project:string,id?:string):JobDto{if(!record(value)||!validUuid(value.id)||value.projectId!==project||(id!==undefined&&value.id!==id)||!states.has(String(value.state))||!Number.isSafeInteger(value.revision))throw new BusinessAiError('AI_CONTEXT_MISMATCH');projects.set(value.id,project);return value as unknown as JobDto;}
    function projectFor(id:string,provided?:string){const project=provided??projects.get(id);if(!validUuid(id)||!validUuid(project))throw new BusinessAiError('AI_CONTEXT_MISMATCH');return project;}
    async function start(url:string,payload:Record<string,unknown>,requestKey:string):Promise<JobDto>{if(!validUuid(payload.projectId))throw new BusinessAiError('AI_INPUT_INVALID');const response=await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestKey})});return checked(response.job,payload.projectId);}
    async function read(id:string,project:string,signal?:AbortSignal):Promise<JobDto>{const response=await request(`/api/ai/jobs/${encodeURIComponent(id)}?projectId=${encodeURIComponent(project)}`,{signal});return checked(response.job,project,id);}
    async function observe(id:string,{signal,onProgress,projectId}:Observer={}):Promise<JsonValue>{const project=projectFor(id,projectId);let previous=-1,unchanged=0;
        while(true){signal?.throwIfAborted();const job=await read(id,project,signal);signal?.throwIfAborted();if(job.revision>=previous){if(job.revision!==previous){onProgress?.(job);unchanged=0;}else unchanged++;previous=job.revision;
            if(job.state==='SUCCEEDED')return job.result;if(terminal.has(job.state))throw new BusinessAiError(job.error?.code??('AI_'+job.state),job.error?.message??'הפעולה הופסקה. אפשר לנסות שוב באמצעות הכפתור.',409);}
            signal?.throwIfAborted();await sleep(Math.min(5000,1000*2**Math.min(unchanged,3)),signal);
        }
    }
    async function restore(projectId:string,kind:AiJobKind,context?:string):Promise<JobDto[]>{const params=new URLSearchParams({projectId,kind});if(context)params.set('clientContextId',context);const response=await request('/api/ai/jobs?'+params);if(!Array.isArray(response.jobs))throw new BusinessAiError('AI_RESPONSE_INVALID');return response.jobs.map(value=>{const job=checked(value,projectId);if(job.kind!==kind||(context&&job.clientContextId!==context))throw new BusinessAiError('AI_CONTEXT_MISMATCH');return job;});}
    async function cancel(id:string,revision:number):Promise<JobDto>{const project=projectFor(id),url=`/api/ai/jobs/${encodeURIComponent(id)}/cancel?projectId=${encodeURIComponent(project)}`;
        const send=async(value:number)=>checked((await request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:value})})).job,project,id);
        try{return await send(revision);}catch(error){if(!(error instanceof BusinessAiError)||error.code!=='AI_JOB_CONFLICT')throw error;const current=await read(id,project);return terminal.has(current.state)?current:send(current.revision);}
    }
    return {start,observe,restore,cancel};
}
const client=createAiJobClient();
export const startAiAction=client.start;
export const observeAiJob=client.observe;
export const restoreAiJobs=client.restore;
export const cancelAiJob=client.cancel;
