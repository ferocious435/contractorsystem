import {record,validUuid} from '@/server/ai/contracts';

const key=(projectId:string,kind:'letter'|'consultant')=>`contractor:writing:${kind}:${projectId}`;
/** Browser work in progress; saved letters and answers are still read from the server. */
export function readWritingBuffer(projectId:string,kind:'letter'|'consultant'):Record<string,unknown>|null {
    try {const raw=localStorage.getItem(key(projectId,kind));if(!raw||raw.length>2_000_000)return null;const value:unknown=JSON.parse(raw);return record(value)&&value.version===1&&value.projectId===projectId?value:null;}catch{return null;}
}
export function writeWritingBuffer(projectId:string,kind:'letter'|'consultant',data:Record<string,unknown>):boolean {
    if(!validUuid(projectId))return false;
    try {localStorage.setItem(key(projectId,kind),JSON.stringify({...data,version:1,projectId}));return true;}catch{return false;}
}
