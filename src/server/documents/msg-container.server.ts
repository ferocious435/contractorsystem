import 'server-only';import {createHash} from 'node:crypto';import path from 'node:path';
import type {MsgExtraction,MsgPart,MsgReadOptions} from '@/utils/msg-source-types';
import {runMsgProcess,msgLimits} from './msg-process.server';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function failedMsgExtraction(file:Buffer,issue:string):MsgExtraction {
    const sourceHash=hash(file),id=hash(sourceHash+'\0root'),part:MsgPart={id,parentId:null,kind:'MESSAGE',name:'message.msg',mimeType:'application/vnd.ms-outlook',containerPath:['root'],payloadHash:sourceHash,byteLength:file.length,body:{text:'',textHash:hash(''),complete:false,issues:[issue]},issues:[issue]};
    return {sourceHash,rootPartId:id,inventoryHash:hash(JSON.stringify([part])),parts:[part],payloads:new Map([[id,file]]),issues:[issue]};
}
export async function readMsgContainer(file:Buffer,options:MsgReadOptions={}):Promise<MsgExtraction> {
    options.signal?.throwIfAborted();
    try {
        const raw:unknown=JSON.parse(await runMsgProcess(file,{executable:process.execPath,args:input=>['--max-old-space-size=192',path.join(process.cwd(),'src/server/documents/msg-container-worker.mjs'),input,JSON.stringify(msgLimits(options))]},options));
        if(!record(raw)||raw.sourceHash!==hash(file)||typeof raw.rootPartId!=='string'||!Array.isArray(raw.parts)||!record(raw.payloads)||!Array.isArray(raw.issues)||typeof raw.inventoryHash!=='string')throw Error('MSG_CONTAINER_RESPONSE_INVALID');
        const payloads=new Map<string,Buffer>();
        for(const [id,value] of Object.entries(raw.payloads)){
            if(!/^[a-f\d]{64}$/.test(id)||typeof value!=='string')throw Error('MSG_PAYLOAD_INVALID');const bytes=Buffer.from(value,'base64'),part=raw.parts.find(p=>record(p)&&p.id===id);
            if(!part||part.payloadHash!==hash(bytes)||part.byteLength!==bytes.length)throw Error('MSG_PAYLOAD_CHANGED');payloads.set(id,bytes);
        }
        payloads.set(raw.rootPartId,file);return {...raw,payloads} as MsgExtraction;
    } catch(error) {
        if(error instanceof Error&&error.name==='AbortError')throw error;
        return failedMsgExtraction(file,error instanceof Error&&error.message.startsWith('MSG_')?error.message.split('\n')[0]:'MSG_CONTAINER_UNREADABLE');
    }
}
