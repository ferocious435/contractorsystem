import {createAiJobClient} from '@/utils/ai-job-client';
import {BusinessAiError,record,validUuid,type JobDto,type JsonObject} from '@/server/ai/contracts';
import type {DocumentJobOptions,ReadingDetail} from '@/utils/visual-source-reading';
import type {ProjectDocument} from './types';
const client=createAiJobClient({fetchImpl:(url,options)=>fetch(url,options)}),pending=new Map<string,string>();
export function documentJobMatches(job:JobDto,projectId:string,documentId?:string,operation?:'analyze'|'read_source') {
    return job.projectId===projectId&&job.kind==='document_analysis'&&validUuid(job.clientContextId)&&(!documentId||job.clientContextId===documentId)
        &&['analyze','read_source'].includes(job.operation??'analyze')&&(!operation||(job.operation??'analyze')===operation);
}
function owned(job:JobDto,projectId:string,documentId?:string,operation?:'analyze'|'read_source'){
    if(!documentJobMatches(job,projectId,documentId,operation))throw new BusinessAiError('AI_CONTEXT_MISMATCH');return job;
}
export async function observeDocumentJob(job:JobDto,signal?:AbortSignal,onProgress?:(job:JobDto)=>void):Promise<JsonObject>{
    owned(job,job.projectId);const result=job.state==='SUCCEEDED'?job.result:await client.observe(job.id,{projectId:job.projectId,signal,
        onProgress:value=>onProgress?.(owned(value,job.projectId,String(job.clientContextId),job.operation??'analyze'))});
    signal?.throwIfAborted();if(!record(result)||result.documentId!==job.clientContextId)throw new BusinessAiError('AI_CONTEXT_MISMATCH');return result as JsonObject;
}
async function requestDocumentJob(projectId:string,documentId:string,operation:'analyze'|'read_source',{signal,onAccepted,onProgress}:DocumentJobOptions={}):Promise<JsonObject>{
    signal?.throwIfAborted();const scope=projectId+':'+documentId+':'+operation,storageKey='document-pending:'+scope;let key=pending.get(scope);
    try{key??=globalThis.sessionStorage?.getItem(storageKey)||undefined;}catch{}key??=crypto.randomUUID();pending.set(scope,key);try{globalThis.sessionStorage?.setItem(storageKey,key);}catch{}
    const job=owned(await client.start('/api/documents/process',{projectId,documentId,operation,clientContextId:documentId},key),projectId,documentId,operation);
    pending.delete(scope);try{globalThis.sessionStorage?.removeItem(storageKey);}catch{}signal?.throwIfAborted();onAccepted?.(job);return observeDocumentJob(job,signal,onProgress);
}
export const requestDocumentAnalysis=(projectId:string,documentId:string,options:DocumentJobOptions={})=>requestDocumentJob(projectId,documentId,'analyze',options);
export const restoreDocumentJobs=async(projectId:string)=>(await client.restore(projectId,'document_analysis')).map(job=>owned(job,projectId));
export const cancelDocumentJob=(job:JobDto)=>client.cancel(job.id,job.revision);
export async function requestDocumentReading(projectId:string,documentId:string,options:DocumentJobOptions={}):Promise<ProjectDocument>{
    await requestDocumentJob(projectId,documentId,'read_source',options);options.signal?.throwIfAborted();return fetchSavedDocument(projectId,documentId,options.signal);
}
export const readDocumentSource=requestDocumentReading;
export async function fetchSavedDocument(projectId:string,documentId:string,signal?:AbortSignal):Promise<ProjectDocument>{
    const response=await fetch('/api/documents?'+new URLSearchParams({projectId}),{cache:'no-store',signal}),body:unknown=await response.json();signal?.throwIfAborted();
    if(!response.ok||!record(body)||body.success!==true||!Array.isArray(body.documents))throw new Error('SAVED_DOCUMENT_READ_FAILED');
    const document=body.documents.find(value=>record(value)&&value.id===documentId&&value.project_id===projectId);if(!document)throw new Error('SAVED_DOCUMENT_NOT_FOUND');return document as ProjectDocument;
}
export async function fetchDocumentReading(projectId:string,documentId:string,query:{textHash?:string;quote?:string;page?:number}={},signal?:AbortSignal):Promise<ReadingDetail>{
    const response=await fetch('/api/documents/reading',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,documentId,...query}),signal,cache:'no-store'}),body:unknown=await response.json();
    signal?.throwIfAborted();if(!response.ok||!record(body)||typeof body.text!=='string'||typeof body.textHash!=='string'||typeof body.sourceHash!=='string'
        ||!Array.isArray(body.visualDescriptions)||!Array.isArray(body.versions)||typeof body.current!=='boolean')throw new Error('SOURCE_READING_NOT_FOUND');return body as unknown as ReadingDetail;
}
/** The upload, including an existing duplicate, continues through the ordinary program worker. */
export async function uploadDocumentAndAnalyze(projectId:string,file:File,category:string,options:DocumentJobOptions&{onUploaded?:(document:ProjectDocument)=>void}={}):Promise<ProjectDocument>{
    options.signal?.throwIfAborted();const form=new FormData();form.set('projectId',projectId);form.set('file',file);form.set('category',category);
    const response=await fetch('/api/documents',{method:'POST',body:form,signal:options.signal}),body:unknown=await response.json();options.signal?.throwIfAborted();
    if(!response.ok||!record(body)||body.success!==true||!record(body.document)||!validUuid(body.document.id)||body.document.project_id!==projectId)throw new Error('DOCUMENT_UPLOAD_FAILED');
    const document=body.document as ProjectDocument;options.onUploaded?.(document);
    if(document.ai_status==='VALIDATED')return requestDocumentReading(projectId,document.id,options);
    await requestDocumentAnalysis(projectId,document.id,options);return fetchSavedDocument(projectId,document.id,options.signal);
}
