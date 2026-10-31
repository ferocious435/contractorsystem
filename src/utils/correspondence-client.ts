import {record,validUuid} from '@/server/ai/contracts';
import type {LetterSourceRef} from './letter-draft-types';

export interface SavedCorrespondence {
    id:string;project_id:string;client_draft_id:string;revision:number;status:'DRAFT'|'SENT';
    subject:string;recipient:string;content:string;source_refs:LetterSourceRef[];created_at:string;
}
const incomplete='לא התקבל אישור מלא. הטקסט נשאר זמין; אפשר לנסות שוב.';
export function isSavedCorrespondence(value:unknown,projectId:string):value is SavedCorrespondence {
    return record(value)&&validUuid(value.id)&&value.project_id===projectId&&validUuid(value.client_draft_id)
        &&Number.isSafeInteger(value.revision)&&Number(value.revision)>0&&['DRAFT','SENT'].includes(String(value.status))
        &&['subject','recipient','content','created_at'].every(key=>typeof value[key]==='string')
        &&Array.isArray(value.source_refs)&&value.source_refs.every(source=>record(source)
            &&['documentId','title','pageLabel','quote','manualNote'].every(key=>source[key]===null||typeof source[key]==='string')
            &&['DOCUMENT','MANUAL'].includes(String(source.basis))&&['VERIFIED','REQUIRES_VERIFICATION'].includes(String(source.status)));
}
async function request(url:string,body:unknown,fetchImpl:typeof fetch):Promise<Record<string,unknown>> {
    let response:Response,value:unknown;
    try {
        response=await fetchImpl(url,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
        value=await response.json();
    } catch {throw Error(incomplete);}
    if(!response.ok||!record(value)||value.success!==true)throw Error(record(value)&&typeof value.error==='string'?value.error:incomplete);
    return value;
}
export async function fetchSavedCorrespondence(projectId:string,fetchImpl:typeof fetch=fetch):Promise<SavedCorrespondence[]> {
    const value=await request('/api/correspondence?projectId='+encodeURIComponent(projectId),undefined,fetchImpl);
    if(!Array.isArray(value.letters)||!value.letters.every(letter=>isSavedCorrespondence(letter,projectId)))throw Error(incomplete);
    return value.letters;
}
export async function writeSavedCorrespondence(body:{projectId:string;[key:string]:unknown},fetchImpl:typeof fetch=fetch):Promise<SavedCorrespondence> {
    const value=await request('/api/correspondence',body,fetchImpl);
    if(!isSavedCorrespondence(value.letter,body.projectId))throw Error(incomplete);
    return value.letter;
}
