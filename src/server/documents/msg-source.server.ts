import 'server-only';
import {msgInventoryPart} from '@/utils/msg-reading-proof';
import type {MsgExtraction,MsgNativeResult,MsgReadOptions} from '@/utils/msg-source-types';
import {readMsgRtf} from './msg-rtf-reading.server';
import {readMsgContainer} from './msg-container.server';import {extractMsgNative} from './msg-native.server';
export function createMsgSourceExtractor(deps:{container:typeof readMsgContainer;native:typeof extractMsgNative;rtf?:typeof readMsgRtf}) {
    return async(file:Buffer,options:MsgReadOptions={}):Promise<MsgExtraction>=>{
        options.signal?.throwIfAborted();const result=await deps.container(file,options);
        for(const part of result.parts){
            if(part.kind!=='MESSAGE')continue;const payload=result.payloads.get(part.id);if(!payload||!part.body)continue;
            try{const native:MsgNativeResult=await deps.native(payload,options);part.headers=native.headers;part.issues.push(...native.issues);}
            catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;part.issues.push('MSG_NATIVE_EXTRACTION_FAILED');}
        }
        if(deps.rtf)for(const part of result.parts.filter(p=>p.representation==='RTF')){
            const payload=result.payloads.get(part.id);if(!payload)continue;
            try{const text=await deps.rtf(payload,options);const {createHash}=await import('node:crypto');part.body={text,textHash:createHash('sha256').update(text).digest('hex'),complete:true,issues:[]};
                const parent=result.parts.find(p=>p.id===part.parentId);if(parent)parent.issues=parent.issues.filter(i=>i!=='MSG_RTF_TEXT_SYNC_UNCONFIRMED');
            }catch(error){if(error instanceof Error&&error.name==='AbortError')throw error;part.issues.push('MSG_RTF_READING_UNCONFIRMED');}
        }
        // The old synchronization flag is superseded only by a successful independent RTF read.
        result.issues=result.issues.filter(i=>i!=='MSG_RTF_TEXT_SYNC_UNCONFIRMED'||result.parts.some(p=>p.issues.includes(i)));
        result.inventoryHash=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(result.parts.map(p=>msgInventoryPart(p)))).digest('hex');
        result.issues=[...new Set([...result.issues,...result.parts.flatMap(p=>p.issues)])];return result;
    };
}
export const extractMsgSource=createMsgSourceExtractor({container:readMsgContainer,native:extractMsgNative,rtf:readMsgRtf});
