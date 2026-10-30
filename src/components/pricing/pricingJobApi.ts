import {createAiJobClient} from '@/utils/ai-job-client';
import {BusinessAiError,record,type JobDto,type JsonValue} from '@/server/ai/contracts';
type Kind='pricing'|'work_change';
const client=createAiJobClient({fetchImpl:(input,options)=>fetch(input,options)}),pending=new Map<string,string>();
function checked(job:JobDto,projectId:string,findingId:string,kind:Kind){if(job.projectId!==projectId||job.clientContextId!==findingId||job.kind!==kind)throw new BusinessAiError('AI_CONTEXT_MISMATCH');return job;}
export async function requestPricingJob(projectId:string,findingId:string,kind:Kind,expertMode=false,signal?:AbortSignal):Promise<JsonValue>{
    const scope=[projectId,findingId,kind,expertMode].join(':'),storageKey='pricing-pending:'+scope;
    let key=pending.get(scope);try{key??=globalThis.sessionStorage?.getItem(storageKey)||undefined;}catch{}
    key??=crypto.randomUUID();pending.set(scope,key);try{globalThis.sessionStorage?.setItem(storageKey,key);}catch{}
    const job=checked(await client.start('/api/pricing/evaluate-ai',{projectId,contradictionId:findingId,clientContextId:findingId,...(kind==='work_change'?{reviewCaseOnly:true}:{expertMode})},key),projectId,findingId,kind);
    pending.delete(scope);try{globalThis.sessionStorage?.removeItem(storageKey);}catch{}
    signal?.throwIfAborted();return job.state==='SUCCEEDED'?job.result:client.observe(job.id,{projectId,signal});
}
export async function restorePricingJob(projectId:string,findingId:string,kind:Kind,signal?:AbortSignal):Promise<JsonValue>{
    const params=new URLSearchParams({projectId,contradictionId:findingId,...(kind==='work_change'?{reviewCaseOnly:'true'}:{})});
    const response=await fetch('/api/pricing/evaluate-ai?'+params,{cache:'no-store',signal}),body:unknown=await response.json();
    if(!response.ok||!record(body)||body.success!==true)throw new Error('לא ניתן לשחזר את הבדיקה השמורה.');
    if(record(body.job)){const job=checked(body.job as unknown as JobDto,projectId,findingId,kind);if(job.state==='QUEUED'||job.state==='RUNNING')return client.observe(job.id,{projectId,signal});
        if(['CANCELLED','FAILED','INTERRUPTED'].includes(job.state)){if(record(body.result))return {...body.result,lastActionState:job.state} as JsonValue;throw new BusinessAiError('AI_'+job.state,job.state==='CANCELLED'?'הבדיקה בוטלה. הנתונים נשמרו.':'הבדיקה הקודמת לא הושלמה. ניתן להפעיל בדיקה חדשה בכפתור.',409);}}
    return (body.result??null) as JsonValue;
}
export async function cancelPricingJob(projectId:string,findingId:string,kind:Kind):Promise<void>{
    const jobs=await client.restore(projectId,kind,findingId),active=jobs.find(job=>job.state==='QUEUED'||job.state==='RUNNING');if(active)await client.cancel(active.id,active.revision);
}
