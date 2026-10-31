import {createAiJobClient} from '@/utils/ai-job-client';
import {BusinessAiError,record,validUuid,type JobDto,type JsonObject} from '@/server/ai/contracts';
import type {ProjectDocument} from './types';
const client=createAiJobClient({fetchImpl:(url,options)=>fetch(url,options)}),pending=new Map<string,string>();
function owned(job:JobDto,projectId:string,documentId?:string){if(job.projectId!==projectId||job.kind!=='document_analysis'||!validUuid(job.clientContextId)||documentId&&job.clientContextId!==documentId)throw new BusinessAiError('AI_CONTEXT_MISMATCH');return job;}
export async function observeDocumentJob(job:JobDto,signal?:AbortSignal):Promise<JsonObject>{
    owned(job,job.projectId);const result=job.state==='SUCCEEDED'?job.result:await client.observe(job.id,{projectId:job.projectId,signal});
    if(!record(result)||result.documentId!==job.clientContextId)throw new BusinessAiError('AI_CONTEXT_MISMATCH');return result as JsonObject;
}
export async function requestDocumentAnalysis(projectId:string,documentId:string,{signal,onAccepted}:{signal?:AbortSignal;onAccepted?:(job:JobDto)=>void}={}):Promise<JsonObject>{
    signal?.throwIfAborted();const scope=projectId+':'+documentId,storageKey='document-pending:'+scope;let key=pending.get(scope);try{key??=globalThis.sessionStorage?.getItem(storageKey)||undefined;}catch{}key??=crypto.randomUUID();pending.set(scope,key);try{globalThis.sessionStorage?.setItem(storageKey,key);}catch{}
    const job=owned(await client.start('/api/documents/process',{projectId,documentId,clientContextId:documentId},key),projectId,documentId);pending.delete(scope);try{globalThis.sessionStorage?.removeItem(storageKey);}catch{}onAccepted?.(job);signal?.throwIfAborted();return observeDocumentJob(job,signal);
}
export const restoreDocumentJobs=async(projectId:string)=>(await client.restore(projectId,'document_analysis')).map(job=>owned(job,projectId));
export const cancelDocumentJob=(job:JobDto)=>client.cancel(job.id,job.revision);
/** Complete reading with the existing local reader; no model job is created. */
export async function readDocumentSource(projectId:string,documentId:string):Promise<ProjectDocument>{
    const response=await fetch('/api/documents/extract-text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,documentId})});
    const result:unknown=await response.json();
    if(!response.ok||!record(result))throw new Error('קריאת המקור לא הושלמה. הנתונים השמורים נשארו זמינים.');
    return fetchSavedDocument(projectId,documentId);
}
export async function fetchSavedDocument(projectId:string,documentId:string):Promise<ProjectDocument>{
    const response=await fetch('/api/documents?'+new URLSearchParams({projectId}),{cache:'no-store'}),body:unknown=await response.json();
    if(!response.ok||!record(body)||body.success!==true||!Array.isArray(body.documents))throw new Error('SAVED_DOCUMENT_READ_FAILED');
    const document=body.documents.find(value=>record(value)&&value.id===documentId&&value.project_id===projectId);if(!document)throw new Error('SAVED_DOCUMENT_NOT_FOUND');return document as ProjectDocument;
}
